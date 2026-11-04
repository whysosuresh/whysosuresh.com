-- The inbox: one row per thing someone told Suresh, from any door. The site's note flow writes rows with
-- `source` `talk`; later doors add their own sources. `body` is the words. Only what every source will
-- always have is NOT NULL: a thing told in person may have no topic, name or email. Value lists that grow
-- (`source`, `topic`, `status`) carry no CHECK, because SQLite can't alter one without rebuilding the table;
-- the code that writes them validates them. Applied by the deploy job before the code that writes it.
CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL,
  topic TEXT,
  body TEXT NOT NULL,
  name TEXT,
  email TEXT,
  status TEXT NOT NULL
);
