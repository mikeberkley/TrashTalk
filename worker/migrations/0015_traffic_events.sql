-- Timestamped page views support exact rolling hour windows going forward.
CREATE TABLE traffic_events(id INTEGER PRIMARY KEY AUTOINCREMENT,visitor TEXT NOT NULL,ip TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX traffic_events_created ON traffic_events(created_at);
