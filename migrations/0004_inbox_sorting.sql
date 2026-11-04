-- The inbox's sorting, written by the inbox's own page (src/inbox.ts). `kind` is the owner's call on a note:
-- `feedback` (something he made should change) or `idea` (a conversation, not a to-do), set when he moves it
-- to To act on or To discuss, and kept after it closes, because Reopen and a reply's draft read it.
-- `drop_reason` is his optional reason for dropping a note; `reply_opened_at` is when Reply last opened his
-- mail. All three stay null until he acts. `status` keeps `received` for a new note and gains `act`,
-- `discuss`, `done` and `dropped`, validated by the code with no CHECK (0002 says why). Applied by the deploy
-- job before the code that writes it.
ALTER TABLE inbox ADD COLUMN kind TEXT;
ALTER TABLE inbox ADD COLUMN drop_reason TEXT;
ALTER TABLE inbox ADD COLUMN reply_opened_at TEXT;
