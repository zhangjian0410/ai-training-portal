-- Additive rollout only: do not modify existing feedback or historical statistics.
CREATE TABLE IF NOT EXISTS visitor_transfers (
 token_hash TEXT PRIMARY KEY,
 visitor TEXT NOT NULL,
 expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS visitor_transfers_expiry ON visitor_transfers(expires);
