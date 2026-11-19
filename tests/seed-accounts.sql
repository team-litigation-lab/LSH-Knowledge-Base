CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, user_type TEXT, status TEXT, first_name TEXT, last_name TEXT, batch_id TEXT);
INSERT INTO users (username, password, user_type, status, first_name, last_name) VALUES ('trainer1', 'admin-pass', 'Admin', 'Approved', 'Matt', 'G.');
CREATE TABLE IF NOT EXISTS site_state (id INTEGER PRIMARY KEY, locked INTEGER, locked_by_batch TEXT, paused INTEGER, updated_at TEXT);
-- tests/portal.cjs: the Portal account behind a Knowledge Base session is re-checked (src/db.js portalStillAllows)
INSERT INTO users (username, password, user_type, status, first_name, last_name, batch_id) VALUES ('alee', 'x', 'Trainee', 'Approved', 'Ann', 'Lee', 'B300926');
INSERT INTO users (username, password, user_type, status, first_name, last_name, batch_id) VALUES ('rexg', 'x', 'Trainee', 'Suspended', 'Rex', 'Gone', 'B300926');
INSERT INTO users (username, password, user_type, status, first_name, last_name, batch_id) VALUES ('oldcoach', 'x', 'Admin', 'Revoked', 'Old', 'Coach', NULL);
CREATE TABLE IF NOT EXISTS deleted_users (username TEXT, user_type TEXT, batch_id TEXT, email TEXT, full_name TEXT, deleted_by TEXT, deleted_at TEXT);
INSERT INTO deleted_users (username, user_type, batch_id, full_name) VALUES ('dgone', 'Trainee', 'B300926', 'Dee M. Gone');
