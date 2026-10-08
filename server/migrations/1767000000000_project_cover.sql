-- Up Migration
-- A project can have a cover (one of a fixed set of dithered covers, or the latest diagram's drawing). Null means automatic.
ALTER TABLE projects ADD COLUMN cover varchar(24);

-- Down Migration
ALTER TABLE projects DROP COLUMN IF EXISTS cover;
