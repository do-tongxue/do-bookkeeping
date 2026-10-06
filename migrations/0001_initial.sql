CREATE TABLE IF NOT EXISTS users (
  user_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  default_target_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  target_id TEXT PRIMARY KEY,
  owner_user_key TEXT NOT NULL,
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('personal', 'family')),
  family_book TEXT NOT NULL DEFAULT '',
  family_key TEXT NOT NULL DEFAULT '',
  book TEXT NOT NULL,
  book_key TEXT NOT NULL,
  client_ledger_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_key) REFERENCES users(user_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS books_client_ledger ON books(owner_user_key, client_ledger_id) WHERE client_ledger_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS books_name ON books(owner_user_key, ledger_type, family_key, book_key) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS books_owner ON books(owner_user_key, enabled, sort_order);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  family_key TEXT NOT NULL DEFAULT '',
  book TEXT NOT NULL,
  merchant TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  datetime TEXT NOT NULL,
  month_key TEXT NOT NULL,
  date_key TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(target_id, client_id),
  FOREIGN KEY (target_id) REFERENCES books(target_id)
);
CREATE INDEX IF NOT EXISTS transactions_target_range ON transactions(target_id, datetime DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_family_range ON transactions(family_key, datetime DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_target_month ON transactions(target_id, month_key, datetime DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_family_month ON transactions(family_key, month_key, datetime DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_target_date ON transactions(target_id, date_key, datetime DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_family_date ON transactions(family_key, date_key, datetime DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS transactions_guard_update
BEFORE UPDATE OF merchant, amount_cents, datetime, category, note, source, type, tags ON transactions
WHEN OLD.deleted_at IS NOT NULL OR NEW.updated_at <= OLD.updated_at OR substr(NEW.datetime, 1, 7) <> OLD.month_key
BEGIN
  SELECT RAISE(ABORT, 'transaction update conflict');
END;
