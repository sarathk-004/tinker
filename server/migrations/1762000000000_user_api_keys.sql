-- Up Migration
-- Bring-your-own-key: a user's own model API key, stored ENCRYPTED (AES-256-GCM, see infrastructure/crypto/secret-box.ts).
-- The database only ever holds ciphertext; the master key lives in the server's environment. The plaintext key is never returned
-- by any API, never logged, and only decrypted in memory for the duration of one request.

CREATE TABLE user_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     varchar(20) NOT NULL CHECK (provider IN ('gemini')),
  ciphertext   bytea NOT NULL,
  iv           bytea NOT NULL CHECK (octet_length(iv) = 12),
  auth_tag     bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  -- Fingerprint of the master key used (not secret, not reversible): lets keys be rotated.
  key_version  varchar(16) NOT NULL,
  -- Last four characters, so people can recognise which key is stored.
  key_last4    varchar(4) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- When the provider last accepted this key (checked when it was saved).
  verified_at  timestamptz,
  last_used_at timestamptz,
  UNIQUE (user_id, provider)
);

-- Same access policy as every other table: server-only role, RLS on with no policies.
ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.user_api_keys FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.user_api_keys FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS user_api_keys;
