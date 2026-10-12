-- Preserve the initial home/testing traffic separately from reported stats.
-- User confirmed the existing traffic is from the operator's home.
CREATE TABLE traffic_excluded_initial_daily AS SELECT * FROM traffic_daily;
CREATE TABLE traffic_excluded_initial_visitors AS SELECT * FROM traffic_visitors;
DELETE FROM traffic_daily;
DELETE FROM traffic_visitors;
