-- Up Migration
-- A diagram has an icon (a name from the app's icon list and a colour, e.g. "Rocket.violet"); a workspace can have a cover, like a project.
ALTER TABLE diagrams ADD COLUMN icon varchar(40);
ALTER TABLE workspaces ADD COLUMN cover varchar(24);

-- Down Migration
ALTER TABLE workspaces DROP COLUMN IF EXISTS cover;
ALTER TABLE diagrams DROP COLUMN IF EXISTS icon;
