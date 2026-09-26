CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, user_type TEXT, status TEXT, first_name TEXT, last_name TEXT, batch_id TEXT);
INSERT INTO users (username, password, user_type, status, first_name, last_name) VALUES ('trainer1', 'admin-pass', 'Admin', 'Approved', 'Matt', 'G.');
CREATE TABLE IF NOT EXISTS site_state (id INTEGER PRIMARY KEY, locked INTEGER, locked_by_batch TEXT, paused INTEGER, updated_at TEXT);
