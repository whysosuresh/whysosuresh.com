-- Reminders (src/store.ts, site/app/reminders.js). Any thread may carry one reminder, a day of his to come back to it:
-- once on a day, or every N days from a day. Three columns, all null while it has none. `remind_start` is the day the
-- series counts from (for once, that day), `remind_every` its repeat in days (1 to 366), null for once, and
-- `remind_on` the next day it is due. Two day columns, because Later moves one time and never the series: with one,
-- a Monday reminder moved to a Tuesday would come back every Tuesday after. Every day is `YYYY-MM-DD` in his zone.
-- Due is never stored: it is `remind_on` compared with today on read, so nothing has to run for a reminder to come
-- due. The store writes only those shapes; they are checked in the code (src/wire.ts), as 0014 keeps a meeting's,
-- because SQLite can't alter a CHECK. The partial index serves the reminders' list, soonest first.
-- Applied by the deploy before the code that writes it; until then the old code reads none of it.

ALTER TABLE threads ADD COLUMN remind_start TEXT;
ALTER TABLE threads ADD COLUMN remind_on TEXT;
ALTER TABLE threads ADD COLUMN remind_every INTEGER;
CREATE INDEX threads_reminder ON threads (remind_on) WHERE remind_on IS NOT NULL;
