CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, user_type TEXT, status TEXT, first_name TEXT, last_name TEXT, batch_id TEXT);
INSERT INTO users (username, password, user_type, status, first_name, last_name) VALUES ('trainer1', 'admin-pass', 'Admin', 'Approved', 'Matt', 'G.');
CREATE TABLE IF NOT EXISTS site_state (id INTEGER PRIMARY KEY, locked INTEGER, locked_by_batch TEXT, paused INTEGER, updated_at TEXT);
-- tests/portal.cjs: the Portal account behind a Knowledge Base session is re-checked (src/db.js portalStillAllows)
INSERT INTO users (id, username, password, user_type, status, first_name, last_name, batch_id) VALUES (20, 'alee', 'x', 'Trainee', 'Approved', 'Ann', 'Lee', 'B300926');
INSERT INTO users (id, username, password, user_type, status, first_name, last_name, batch_id) VALUES (21, 'rexg', 'x', 'Trainee', 'Suspended', 'Rex', 'Gone', 'B300926');
INSERT INTO users (id, username, password, user_type, status, first_name, last_name, batch_id) VALUES (22, 'oldcoach', 'x', 'Admin', 'Revoked', 'Old', 'Coach', NULL);
INSERT INTO users (id, username, password, user_type, status, first_name, last_name, batch_id) VALUES (23, 'coachana', 'x', 'Admin', 'Approved', 'Coach', 'Ana', NULL);
CREATE TABLE IF NOT EXISTS deleted_users (username TEXT, user_type TEXT, batch_id TEXT, email TEXT, full_name TEXT, deleted_by TEXT, deleted_at TEXT);
INSERT INTO deleted_users (username, user_type, batch_id, full_name) VALUES ('dgone', 'Trainee', 'B300926', 'Dee M. Gone');
-- (security review 2026-11-19) a deleted admin with a middle initial and a suffix: their old name-only KB session is refused
INSERT INTO deleted_users (username, user_type, batch_id, full_name) VALUES ('tadmin', 'Admin', NULL, 'Tom R Admin');
