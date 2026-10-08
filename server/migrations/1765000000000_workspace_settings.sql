-- Up Migration
-- Workspace settings: a description, who may look (private to members, or anyone signed in who has the link), soft delete, and
-- invitations for people who have no account yet (claimed when they first sign in with that email).

ALTER TABLE workspaces
  ADD COLUMN description varchar(300),
  ADD COLUMN visibility  varchar(10) NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
  ADD COLUMN deleted_at  timestamptz;

CREATE TABLE workspace_invites (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        varchar(320) NOT NULL CHECK (email = lower(email)),
  role         varchar(20) NOT NULL CHECK (role IN ('EDITOR', 'VIEWER')),
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE INDEX workspace_invites_email_idx ON workspace_invites (email);

-- Same access policy as every other table: server-only role, RLS on with no policies.
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.workspace_invites FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.workspace_invites FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP TABLE IF EXISTS workspace_invites;
ALTER TABLE workspaces DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS visibility, DROP COLUMN IF EXISTS description;
