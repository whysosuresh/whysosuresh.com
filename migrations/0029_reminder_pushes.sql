-- The morning's push of what is due (src/push.ts, `sendMorning`): one row per day in his zone that a run of the hourly
-- trigger claimed (`claimed_at`), and when a push service took it for at least one of his devices (`sent_at`) and for
-- how many (`count`). A run claims the day before it sends, by inserting its row, so two runs never both send; a run
-- whose every device failed deletes its claim, so the next hour tries again; a claim left by a run that died is taken
-- over once it is half an hour old. A day with nothing due, or no device, has no row. It never names a thread or a
-- device.
-- Applied by the deploy before the code that writes it; until then the old code reads none of it.

CREATE TABLE reminder_pushes (
  day TEXT PRIMARY KEY,
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  count INTEGER
);
