-- Raise the lifetime trial from three to five without resetting usage.
-- Merged anonymous identities do not receive a second account allowance.
INSERT OR IGNORE INTO ledger(owner,kind,amount,pool,business_key,created_at)
SELECT p.id,'grant',2,'trial','trial-five-upgrade:' || p.id,unixepoch()
FROM principals p
WHERE p.merged_into IS NULL
  AND EXISTS (
    SELECT 1 FROM ledger l
    WHERE l.owner=p.id AND l.pool='trial' AND l.kind='grant'
      AND l.business_key='trial:' || p.id AND l.amount=3
  );
