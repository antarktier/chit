CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  reference TEXT NOT NULL,
  recipient TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  partial_allowed INTEGER NOT NULL,
  pay_contract TEXT NOT NULL,
  details TEXT NOT NULL,
  request_json TEXT NOT NULL,
  signature_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  paid TEXT NOT NULL DEFAULT '0',
  pending TEXT NOT NULL DEFAULT '0',
  updated_at TEXT NOT NULL,
  UNIQUE (merchant, reference)
);
CREATE INDEX IF NOT EXISTS requests_merchant ON requests (merchant, created_at);
CREATE INDEX IF NOT EXISTS requests_recipient ON requests (recipient, status);

CREATE TABLE IF NOT EXISTS events (
  key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  source TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  idx INTEGER NOT NULL,
  block_height INTEGER NOT NULL,
  block_time INTEGER NOT NULL,
  payer TEXT NOT NULL,
  recipient TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_request ON events (request_id, block_height);

CREATE TABLE IF NOT EXISTS cursors (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
