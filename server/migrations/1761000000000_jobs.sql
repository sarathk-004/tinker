-- Up Migration
-- I8 (decision D12): Postgres-backed background jobs. No queue service: a table, short claim transactions, expiring leases.
-- Only the job types that exist today are allowed; export/analysis workers are added with their own migration when those
-- features have acceptance criteria.

CREATE TABLE jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             varchar(60) NOT NULL CHECK (type IN ('PRUNE_REVISIONS', 'CLEANUP_EXPIRED_REQUESTS', 'PURGE_DELETED_DIAGRAMS')),
  -- Deduplicates enqueueing: the same operation is never queued twice.
  operation_key    varchar(200) NOT NULL UNIQUE,
  payload          jsonb NOT NULL DEFAULT '{}',
  status           varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'DEAD_LETTER')),
  attempt_count    int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts     int NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  available_at     timestamptz NOT NULL DEFAULT now(),
  -- The current holder's proof of ownership. Completion, failure and heartbeats must present it (fencing).
  lease_token      uuid,
  lease_expires_at timestamptz,
  locked_at        timestamptz,
  completed_at     timestamptz,
  -- Sanitized, short, for diagnosis only. kind separates a crashed holder from a bad payload from an outside failure.
  last_error       varchar(300),
  last_error_kind  varchar(20) CHECK (last_error_kind IN ('LEASE_EXPIRED', 'SCHEMA', 'EXTERNAL', 'INTERNAL')),
  result           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- What a claim looks for: due pending work, and running work whose lease has lapsed.
CREATE INDEX jobs_claim_idx ON jobs (available_at) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX jobs_finished_idx ON jobs (completed_at) WHERE status IN ('COMPLETED', 'DEAD_LETTER');

-- Same access policy as every other table: server-only role, RLS on with no policies.
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.jobs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.jobs FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS jobs;
