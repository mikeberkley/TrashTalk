CREATE TRIGGER reverse_refunded_release AFTER UPDATE OF state ON reservations WHEN OLD.state='reserved' AND NEW.state='released' AND NEW.pool='paid' BEGIN
 INSERT OR IGNORE INTO ledger(owner,kind,amount,pool,business_key,job_id,payment_id,created_at) SELECT NEW.owner,'reversal',-1,'paid','refund-release:'||NEW.job_id,NEW.job_id,a.payment_id,unixepoch() FROM paid_allocations a JOIN purchases p ON p.session_id=a.payment_id WHERE a.job_id=NEW.job_id AND p.status='review';
END;
