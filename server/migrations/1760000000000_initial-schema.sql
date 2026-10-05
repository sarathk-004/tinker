-- Up Migration
-- Phase 3 LLD sections 2, 4, 6, 13 plus decisions D01 (generic mutation_requests) and D09 (personal workspace bootstrap key).
-- Identity: Supabase Auth owns credentials; Tinker owns authorization and internal UUIDs.

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_auth_id varchar(255) NOT NULL UNIQUE,
  email            varchar(320),
  display_name     varchar(200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 varchar(120) NOT NULL,
  created_by           uuid REFERENCES users(id),
  -- Unique bootstrap key: at most one personal workspace per user, so concurrent first requests cannot duplicate it.
  personal_for_user_id uuid UNIQUE REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         varchar(20) NOT NULL CHECK (role IN ('OWNER', 'EDITOR', 'VIEWER')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON workspace_memberships (user_id);

CREATE TABLE diagrams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name         varchar(160) NOT NULL,
  graph        jsonb NOT NULL,
  presentation jsonb NOT NULL,
  version      bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX diagrams_workspace_updated_idx ON diagrams (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE diagram_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id   uuid NOT NULL REFERENCES diagrams(id),
  version      bigint NOT NULL,
  graph        jsonb NOT NULL,
  presentation jsonb NOT NULL,
  reason       varchar(80) NOT NULL CHECK (reason IN ('AI_COMMAND', 'MANUAL_COMMAND', 'AUTOSAVE', 'CHECKPOINT', 'RESTORE')),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (diagram_id, version)
);
CREATE INDEX revision_diagram_created_idx ON diagram_revisions (diagram_id, created_at DESC);

CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_diagram_idx ON conversations (diagram_id, updated_at DESC);

CREATE TABLE conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  role            varchar(20) NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content         text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_messages_idx ON conversation_messages (conversation_id, created_at ASC);

-- D01/D02/D03: one row per persistent mutation request (including creates that have no diagram yet).
CREATE TABLE mutation_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid NOT NULL REFERENCES users(id),
  idempotency_key varchar(128) NOT NULL,
  request_hash    char(64) NOT NULL,
  method          varchar(10) NOT NULL,
  resource        varchar(300) NOT NULL,
  diagram_id      uuid REFERENCES diagrams(id),
  status          varchar(20) NOT NULL CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'RETRYABLE_FAILED')),
  lease_token     uuid,
  lease_expires_at timestamptz,
  attempt_count   int NOT NULL DEFAULT 1,
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (actor_id, idempotency_key)
);
CREATE INDEX mutation_requests_diagram_idx ON mutation_requests (diagram_id, created_at DESC);

CREATE TABLE command_executions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mutation_request_id uuid NOT NULL UNIQUE REFERENCES mutation_requests(id),
  diagram_id          uuid NOT NULL REFERENCES diagrams(id),
  actor_id            uuid NOT NULL REFERENCES users(id),
  command_type        varchar(60) NOT NULL,
  command_payload     jsonb NOT NULL,
  status              varchar(20) NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  error_code          varchar(60),
  expected_version    bigint,
  result_version      bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE INDEX command_diagram_created_idx ON command_executions (diagram_id, created_at DESC);

-- Access policy: the API connects with a server-only role. Row level security is enabled on every table with NO policies,
-- so any role that is not the owner (Supabase's anon/authenticated PostgREST roles) sees nothing even if grants slip in.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS command_executions;
DROP TABLE IF EXISTS mutation_requests;
DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS diagram_revisions;
DROP TABLE IF EXISTS diagrams;
DROP TABLE IF EXISTS workspace_memberships;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS users;
