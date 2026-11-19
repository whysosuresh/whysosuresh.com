-- The devices Suresh turned reminders on for (src/push.ts): each is a browser's push subscription, the address its
-- push service gives (`endpoint`, one of the push services' own, kept once) and the two keys a message is encrypted
-- with (`p256dh`, the device's P-256 public key, and `auth`, its 16-byte secret, each base64url). The endpoint and
-- keys are capabilities: anyone holding them can send that device a message, so they are never logged and never
-- answered by any call. `last_ok_at` is when a push service last took a message for it, null until one has. A device
-- whose push service says it is gone (404 or 410) is deleted. Only he adds one, from his own page.
-- Applied by the deploy before the code that writes it; until then the old code reads none of it.

CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);
