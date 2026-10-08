-- Up Migration
-- Profile pictures: one small image per person, kept in our own database (no file-storage service, nothing public).
-- The API validates every upload (real PNG, JPEG or WebP, at most 256 KB and 1024 px a side); the CHECKs are the last line of defence.

CREATE TABLE user_avatars (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type varchar(20) NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data         bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 262144),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Same access policy as every other table: server-only role, RLS on with no policies.
ALTER TABLE public.user_avatars ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.user_avatars FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.user_avatars FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS user_avatars;
