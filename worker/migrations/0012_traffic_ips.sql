CREATE TABLE traffic_ip_daily(day TEXT NOT NULL,ip TEXT NOT NULL,views INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,ip));
CREATE TABLE traffic_visitor_ips(day TEXT NOT NULL,visitor TEXT NOT NULL,ip TEXT NOT NULL,PRIMARY KEY(day,visitor,ip));
