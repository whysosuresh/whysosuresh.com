-- The talk flow's tables: one row per recording someone sent, and the two tables that count today's
-- sends without keeping anyone's address. Applied by the deploy job before the code that uses it.
-- Migrations only add: the running code must keep working on the schema the next one leaves.

-- What people sent. The audio itself is in the recordings' bucket at `audio_key`. Value lists that grow
-- (`source`, `status`) carry no CHECK, because SQLite can't alter one without rebuilding the table; the
-- code that writes them validates them.
CREATE TABLE inputs (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL,
  name TEXT,
  email TEXT,
  audio_key TEXT NOT NULL,
  audio_type TEXT NOT NULL,
  audio_bytes INTEGER NOT NULL,
  duration_s INTEGER NOT NULL,
  status TEXT NOT NULL
);

-- One random salt per UTC day. Each send deletes earlier days, so once a day is gone its hashes can't be
-- matched to anyone.
CREATE TABLE talk_days (
  day TEXT PRIMARY KEY,
  salt BLOB NOT NULL
);

-- Today's sends per network: `sender` is the hex SHA-256 of the day's salt and the network (an IPv4
-- address, or an IPv6 address's /64). The day's total is the sum of `sends`, never a second counter.
CREATE TABLE talk_senders (
  day TEXT NOT NULL,
  sender TEXT NOT NULL,
  sends INTEGER NOT NULL,
  PRIMARY KEY (day, sender)
);
