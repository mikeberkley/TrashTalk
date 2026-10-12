PRAGMA foreign_keys=ON;
CREATE TABLE principals(id TEXT PRIMARY KEY,google_sub TEXT UNIQUE,created_at INTEGER NOT NULL,merged_into TEXT,review INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,principal TEXT NOT NULL REFERENCES principals(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE leagues(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,checked_at TEXT,report TEXT);
CREATE TABLE teams(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,active_version TEXT NOT NULL);
CREATE TABLE team_versions(team_id TEXT NOT NULL,version TEXT NOT NULL,logo_key TEXT NOT NULL,logo_hash TEXT NOT NULL,palette_hash TEXT NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(team_id,version));
CREATE TABLE memberships(league TEXT NOT NULL,team_id TEXT NOT NULL,PRIMARY KEY(league,team_id));
CREATE TABLE uploads(id TEXT PRIMARY KEY,owner TEXT NOT NULL,object_key TEXT NOT NULL,hash TEXT NOT NULL,mime TEXT NOT NULL,created_at INTEGER NOT NULL,attached_at INTEGER);
CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idempotency TEXT NOT NULL,input_hash TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,context TEXT,caption TEXT,artwork TEXT,error TEXT,retry_of TEXT,attempt INTEGER NOT NULL DEFAULT 0,call_started TEXT,UNIQUE(owner,idempotency));
CREATE UNIQUE INDEX one_active_job ON jobs(owner) WHERE status IN ('queued','researching','captioning','imaging');
CREATE TABLE ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,pool TEXT NOT NULL,business_key TEXT NOT NULL UNIQUE,job_id TEXT,payment_id TEXT,created_at INTEGER NOT NULL);
CREATE INDEX ledger_owner ON ledger(owner,pool);
CREATE TABLE reservations(job_id TEXT PRIMARY KEY,owner TEXT NOT NULL,pool TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','captured','released')));
CREATE TABLE purchases(session_id TEXT PRIMARY KEY,owner TEXT NOT NULL,payment_id TEXT UNIQUE,status TEXT NOT NULL,amount INTEGER NOT NULL,credits INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE webhook_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE shares(token TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
CREATE TABLE cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,object_id TEXT,detail TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TRIGGER reserve_credit BEFORE INSERT ON reservations WHEN NEW.state='reserved' BEGIN
 SELECT RAISE(ABORT,'insufficient_credit') WHERE (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE owner=NEW.owner AND pool=NEW.pool)<1;
END;
CREATE TRIGGER reserve_ledger AFTER INSERT ON reservations BEGIN
 INSERT INTO ledger(owner,kind,amount,pool,business_key,job_id,created_at) VALUES(NEW.owner,'reservation',-1,NEW.pool,'reserve:'||NEW.job_id,NEW.job_id,unixepoch());
END;
CREATE TRIGGER finish_reservation AFTER UPDATE OF state ON reservations WHEN OLD.state='reserved' AND NEW.state IN ('captured','released') BEGIN
 INSERT INTO ledger(owner,kind,amount,pool,business_key,job_id,created_at) VALUES(NEW.owner,NEW.state,(NEW.state='released'),NEW.pool,NEW.state||':'||NEW.job_id,NEW.job_id,unixepoch());
END;
