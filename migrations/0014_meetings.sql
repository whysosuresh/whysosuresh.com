-- Meetings (src/store.ts). Any thread can be one meeting, once it has a when: `meeting_when` is null, a day
-- (`YYYY-MM-DD`, the same day for every reader, its time not set yet) or an instant (`YYYY-MM-DDTHH:MM:SS.sssZ`, in
-- UTC, which each reader sees in their own time zone). One column holds either, so a thread has one truth about when:
-- a day and an instant in two columns would disagree for a reader abroad, where "the day" of a moment is another
-- day. The store writes only those two shapes; the shape is checked in the code (src/wire.ts), as 0006 keeps every
-- value check, because SQLite can't alter a CHECK. `meeting_minutes` is its length (5 to 1440) and `meeting_where` one
-- line saying where (a call, an office), each null when not said.
--
-- `attendees` says who will be in the room besides Suresh, who is in every meeting of his and is never a person. It
-- is not `members`, on purpose: a `members` row is an invitation, which opens the thread and answers yes at sign-in
-- (`isInvited`), and being in a meeting grants nothing, so an attendee may be someone with no address, and one with
-- an address can't sign in for it. A person taken off a meeting loses the row, and the thread's history keeps the
-- `attendee-removed` event; unlike a removed invitation, which a person's page still shows, an attendee taken off was
-- never in the meeting. The partial index serves Today's meetings, and the person index a person's meetings.
-- Applied by the deploy before the code that writes it; until then the old code reads none of it.

ALTER TABLE threads ADD COLUMN meeting_when TEXT;
ALTER TABLE threads ADD COLUMN meeting_minutes INTEGER;
ALTER TABLE threads ADD COLUMN meeting_where TEXT;
CREATE INDEX threads_meeting ON threads (meeting_when) WHERE meeting_when IS NOT NULL;

CREATE TABLE attendees (
  thread_id TEXT NOT NULL REFERENCES threads (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, person_id)
);
CREATE INDEX attendees_person ON attendees (person_id);
