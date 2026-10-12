CREATE TABLE IF NOT EXISTS favorites(owner TEXT NOT NULL REFERENCES principals(id),team_id TEXT NOT NULL REFERENCES teams(id),PRIMARY KEY(owner,team_id));
