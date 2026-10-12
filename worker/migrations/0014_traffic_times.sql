ALTER TABLE traffic_ip_daily ADD COLUMN first_seen INTEGER;
ALTER TABLE traffic_ip_daily ADD COLUMN last_seen INTEGER;
ALTER TABLE traffic_visitors ADD COLUMN first_seen INTEGER;
ALTER TABLE traffic_visitors ADD COLUMN last_seen INTEGER;
