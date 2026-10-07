-- Up Migration
-- Daily AI allowance (security review H1): one counter per person per UTC day per kind, plus a 'GLOBAL' scope that is the
-- service-wide budget breaker. Rows are tiny and only the current day matters; the cleanup job removes old days.

CREATE TABLE usage_daily (
  scope      varchar(64) NOT NULL,          -- a user id, or 'GLOBAL'
  day        date NOT NULL,                  -- UTC day
  kind       varchar(10) NOT NULL CHECK (kind IN ('AI', 'VOICE')),
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, day, kind)
);
CREATE INDEX usage_daily_day_idx ON usage_daily (day);

-- Same access policy as every other table: server-only role, RLS on with no policies.
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.usage_daily FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.usage_daily FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS usage_daily;
