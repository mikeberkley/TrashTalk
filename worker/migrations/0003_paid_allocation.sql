CREATE TABLE paid_allocations(job_id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES purchases(session_id));
CREATE TRIGGER paid_reservation_grant BEFORE INSERT ON reservations WHEN NEW.pool='paid' BEGIN
 SELECT RAISE(ABORT,'no_available_paid_grant') WHERE NOT EXISTS(SELECT 1 FROM purchases p WHERE p.owner=NEW.owner AND p.status='paid' AND p.credits>(SELECT COUNT(*) FROM paid_allocations a JOIN reservations r ON r.job_id=a.job_id WHERE a.payment_id=p.session_id AND r.state!='released'));
END;
CREATE TRIGGER allocate_paid AFTER INSERT ON reservations WHEN NEW.pool='paid' BEGIN
 INSERT INTO paid_allocations(job_id,payment_id) SELECT NEW.job_id,p.session_id FROM purchases p WHERE p.owner=NEW.owner AND p.status='paid' AND p.credits>(SELECT COUNT(*) FROM paid_allocations a JOIN reservations r ON r.job_id=a.job_id WHERE a.payment_id=p.session_id AND r.state!='released') ORDER BY p.created_at,p.session_id LIMIT 1;
END;
