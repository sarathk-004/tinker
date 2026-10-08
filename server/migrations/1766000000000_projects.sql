-- Up Migration
-- Workspace -> Project -> Diagram. Every diagram belongs to a project; existing diagrams go into a "General" project of their workspace.

CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         varchar(120) NOT NULL,
  description  varchar(300),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX projects_workspace_idx ON projects (workspace_id) WHERE deleted_at IS NULL;

ALTER TABLE diagrams ADD COLUMN project_id uuid REFERENCES projects(id);

INSERT INTO projects (workspace_id, name, created_by) SELECT id, 'General', created_by FROM workspaces;
UPDATE diagrams d SET project_id = (SELECT p.id FROM projects p WHERE p.workspace_id = d.workspace_id ORDER BY p.created_at LIMIT 1);

ALTER TABLE diagrams ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX diagrams_project_idx ON diagrams (project_id, updated_at DESC) WHERE deleted_at IS NULL;

-- Same access policy as every other table: server-only role, RLS on with no policies.
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.projects FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.projects FROM authenticated;
  END IF;
END $$;

-- Down Migration
DROP INDEX IF EXISTS diagrams_project_idx;
ALTER TABLE diagrams DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS projects;
