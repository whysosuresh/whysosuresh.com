// @ts-check
// The threads' service worker, there for one thing: his reminders reach his devices with the site closed. It shows
// each push the Worker sends (src/push.ts: a title and its lines, encrypted for this device, so the push service in
// between reads none of it) as one notification, always, as an iPhone requires of a push, and a tap on it opens
// Today, focusing the site where it is already open. It has no fetch handler: it never caches or answers a request,
// so the site is always the live one. It sits at the root so its scope is the whole site; the page registers it only
// when he opens his Notifications switch on a device that can take pushes (site/app/threads.js).

/**
 * The parts of a service worker's events this uses; the page's own type check knows the window, not a worker.
 * @typedef {{ waitUntil(promise: Promise<unknown>): void }} Extendable
 * @typedef {Extendable & { data: { json(): unknown } | null }} PushLike
 * @typedef {Extendable & { notification: { close(): void } }} ClickLike
 * @typedef {{ url: string, focus(): Promise<unknown>, navigate(url: string): Promise<unknown> }} WindowLike
 * @typedef {{
 *   registration: { showNotification(title: string, options: { body: string, icon: string, tag: string }): Promise<void> },
 *   clients: { matchAll(options: { type: 'window', includeUncontrolled: boolean }): Promise<WindowLike[]>, openWindow(url: string): Promise<unknown> },
 *   location: { origin: string },
 *   addEventListener(type: string, listener: (event: unknown) => void): void,
 * }} WorkerLike
 */

const worker = /** @type {WorkerLike} */ (/** @type {unknown} */ (self));
/** What a push says when its words can't be read: something is due, and Today says what. */
const FALLBACK = { title: 'Reminders due', lines: ['Open Today to see them.'] };

/** The push's title and lines, or the fallback for anything else. @param {PushLike} event */
function said(event) {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return FALLBACK;
  }
  if (typeof data !== 'object' || data === null) return FALLBACK;
  const title = 'title' in data && typeof data.title === 'string' ? data.title : FALLBACK.title;
  const lines = 'lines' in data && Array.isArray(data.lines) ? data.lines.filter((line) => typeof line === 'string') : [];
  return { title, lines };
}

worker.addEventListener('push', (event) => {
  const push = /** @type {PushLike} */ (event);
  const { title, lines } = said(push);
  // One notification at a time: a new morning's replaces an unread one, under one tag.
  push.waitUntil(worker.registration.showNotification(title, { body: lines.join('\n'), icon: '/img/icon-192.png', tag: 'reminders' }));
});

worker.addEventListener('notificationclick', (event) => {
  const click = /** @type {ClickLike} */ (event);
  click.notification.close();
  click.waitUntil(
    worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      const site = open.find((client) => new URL(client.url).origin === worker.location.origin);
      return site ? site.navigate('/').then(() => site.focus()) : worker.clients.openWindow('/');
    }),
  );
});
