PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  first_month TEXT,
  last_month TEXT,
  last_modified_on TEXT,
  currency_format_json TEXT,
  date_format_json TEXT,
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_settings (
  plan_id TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  on_budget INTEGER NOT NULL,
  closed INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  cleared_balance INTEGER NOT NULL,
  uncleared_balance INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_plan_idx ON accounts(plan_id, closed, name);

CREATE TABLE IF NOT EXISTS category_groups (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS category_groups_plan_idx ON category_groups(plan_id, hidden, name);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  category_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  goal_type TEXT,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS categories_group_idx ON categories(plan_id, category_group_id, hidden, name);

CREATE TABLE IF NOT EXISTS months (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  income INTEGER NOT NULL,
  budgeted INTEGER NOT NULL,
  activity INTEGER NOT NULL,
  to_be_budgeted INTEGER NOT NULL,
  age_of_money INTEGER,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(plan_id, month)
);

CREATE TABLE IF NOT EXISTS month_categories (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  budgeted INTEGER NOT NULL,
  activity INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  goal_type TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(plan_id, month, category_id)
);
CREATE INDEX IF NOT EXISTS month_categories_month_idx ON month_categories(plan_id, month, category_group_id);

CREATE TABLE IF NOT EXISTS payees (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payee_locations (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  payee_id TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  cleared TEXT NOT NULL,
  approved INTEGER NOT NULL,
  flag_color TEXT,
  flag_name TEXT,
  payee_id TEXT,
  category_id TEXT,
  transfer_account_id TEXT,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_plan_date_idx ON transactions(plan_id, date DESC, id);
CREATE INDEX IF NOT EXISTS transactions_account_date_idx ON transactions(plan_id, account_id, date DESC);

CREATE TABLE IF NOT EXISTS subtransactions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  payee_id TEXT,
  category_id TEXT,
  transfer_account_id TEXT,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS subtransactions_parent_idx ON subtransactions(plan_id, transaction_id);

CREATE TABLE IF NOT EXISTS scheduled_transactions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date_first TEXT NOT NULL,
  date_next TEXT,
  frequency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  payee_id TEXT,
  category_id TEXT,
  flag_color TEXT,
  flag_name TEXT,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_transactions_plan_date_idx ON scheduled_transactions(plan_id, date_next);

CREATE TABLE IF NOT EXISTS scheduled_subtransactions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  scheduled_transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  payee_id TEXT,
  category_id TEXT,
  deleted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS money_movement_groups (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  group_created_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS money_movements (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  month TEXT,
  moved_at TEXT,
  money_movement_group_id TEXT,
  from_category_id TEXT,
  to_category_id TEXT,
  amount INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  server_knowledge INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plan_id, resource_key)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('initial', 'delta')),
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'failed', 'complete')),
  stage TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  steps_json TEXT NOT NULL,
  starting_knowledge INTEGER NOT NULL DEFAULT 0,
  server_knowledge INTEGER NOT NULL DEFAULT 0,
  counts_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sync_jobs_updated_idx ON sync_jobs(updated_at DESC);
