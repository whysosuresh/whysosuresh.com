-- Where a comment sits (src/store.ts). A comment is one of four kinds, and they are exclusive: a general comment on
-- the thread, with none of these set; an answer to one of the thread's page's questions (`question`, the id the page
-- marks it with, which stays fixed across versions); a comment on words of the page (`quote`, the words selected, with
-- up to 64 characters of text either side, `quote_prefix` and `quote_suffix`, so the same words can be found again in
-- a later version, and `page_version`, the version they were selected on); or a reply (`parent_id`), which names a
-- comment that is itself none of a reply, an answer or a visitor's note, and carries no place of its own, because it
-- sits where its parent does. A reply takes its parent's audience. Changing an answer is a new answer to the same
-- question, so nothing is overwritten and the history keeps every one. Every comment written before this one is a
-- general comment. The partial index serves a comment's replies. Applied by the deploy before the code that writes
-- it; until then the old code reads none of it.

ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments (id);
ALTER TABLE comments ADD COLUMN question TEXT;
ALTER TABLE comments ADD COLUMN quote TEXT;
ALTER TABLE comments ADD COLUMN quote_prefix TEXT;
ALTER TABLE comments ADD COLUMN quote_suffix TEXT;
ALTER TABLE comments ADD COLUMN page_version INTEGER;
CREATE INDEX comments_parent ON comments (parent_id) WHERE parent_id IS NOT NULL;
