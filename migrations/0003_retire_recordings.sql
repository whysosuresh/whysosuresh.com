-- Retires the recordings' table. The site no longer takes voice: since 0002 the note flow writes the
-- inbox, and the code deployed with 0002 never reads `inputs`. This drop runs a deploy later, so the code
-- running while it applies doesn't read the table either, and a failed deploy still leaves a working site.
DROP TABLE inputs;
