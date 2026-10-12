CREATE TABLE traffic_daily(day TEXT PRIMARY KEY,views INTEGER NOT NULL DEFAULT 0);
CREATE TABLE traffic_visitors(day TEXT NOT NULL,visitor TEXT NOT NULL,PRIMARY KEY(day,visitor));
