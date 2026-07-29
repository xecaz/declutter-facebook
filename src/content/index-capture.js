/**
 * Build the friends and groups index from pages the user opens themselves.
 *
 * This is the piece with the sharpest boundary around it. Reading DOM that
 * Facebook already rendered for a page you navigated to is ordinary client-side
 * behaviour. Driving the page to harvest more of it — auto-scrolling the friend
 * list, opening pages in the background, calling the internal API — is
 * automated collection, is against Facebook's terms, and is what actually gets
 * accounts locked.
 *
 * So: no scrolling, no navigation, no requests. The user scrolls their own
 * friends list at their own pace and we record what appears. Capturing the
 * whole list simply means scrolling to the bottom of it once.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const S = FBF.selectors;
  const storage = FBF.storage;

  /** At most one capture pass per this many ms, and at least one while scrolling. */
  const MIN_INTERVAL_MS = 800;

  let observer = null;
  let timer = null;
  let lastRunAt = 0;
  let mode = null; // 'friends' | 'groups' | null

  /** Last capture result, surfaced in the popup as reassurance it worked. */
  let lastCapture = null;

  function detectMode() {
    if (S.isFriendsList()) return 'friends';
    if (S.isGroupsList()) return 'groups';
    return null;
  }

  async function capture() {
    if (!mode) return;
    try {
      const entries = mode === 'friends' ? S.captureProfiles() : S.captureGroups();
      if (!entries.length) return;

      const { added, total } = await storage.mergeIndex(mode, entries);
      lastCapture = { mode, found: entries.length, added, total, at: Date.now() };
    } catch {
      // Capture is best-effort; a failed pass just means fewer entries.
    }
  }

  /**
   * Throttle, emphatically not a debounce.
   *
   * The first version debounced: every mutation cancelled the pending timer
   * and started a new one. On a quiet page that coalesces a burst of new rows
   * into one pass, which is what it was for. On Facebook it never runs at all
   * — the page mutates continuously (timestamps ticking, presence dots, lazy
   * images, hover state), reliably more often than the delay, so the timer is
   * cancelled forever. Capture happened once at page load and never again, and
   * the index froze at whatever the first screenful held.
   *
   * A throttle inverts the rule: the first mutation schedules a pass, and
   * further mutations while one is scheduled are ignored rather than pushing
   * it back. Continuous mutation now guarantees a pass every MIN_INTERVAL_MS
   * instead of preventing one.
   */
  function requestCapture() {
    if (timer != null) return; // a pass is already scheduled; let it happen

    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRunAt));
    timer = setTimeout(() => {
      timer = null;
      lastRunAt = Date.now();
      capture();
    }, wait);
  }

  function start() {
    const next = detectMode();
    if (next === mode && observer) return;

    stop();
    mode = next;
    if (!mode) return;

    // These lists load more rows as the user scrolls, so we watch for new rows
    // rather than reading once. We never trigger the scrolling ourselves.
    //
    // Watch the whole document, not role="main". On /friends/list the
    // role="main" elements are empty and the rows render elsewhere, so an
    // observer scoped to main never fires: the initial capture picks up the
    // first screenful and every row scrolled afterwards is silently missed.
    // That reads as "capture works but only finds a handful", which is a far
    // more confusing failure than finding nothing at all.
    //
    // Watching the body costs more callbacks, but they are debounced into one
    // pass, so the extra cost is a few no-op timer resets.
    observer = new MutationObserver(requestCapture);
    observer.observe(document.body, { childList: true, subtree: true });

    requestCapture();
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    lastRunAt = 0;
    mode = null;
  }

  /**
   * Capture from whatever page is open, on request, ignoring the route rules.
   *
   * The automatic capture above depends on recognising two specific URLs, and
   * a URL Facebook has since renamed looks exactly like a broken extension:
   * nothing happens and nothing explains why. This is the escape hatch — the
   * user can see how many profiles are visible and decide to take them.
   *
   * Being explicit is also what makes it safe. The reason automatic capture is
   * fussy about URLs is that pages like /friends mix in "People you may know",
   * and quietly absorbing strangers into the allowlist would corrupt the
   * measurement. A button the user presses, having been told the count, is a
   * decision rather than an accident.
   */
  async function captureNow(kind) {
    const which = kind === 'groups' ? 'groups' : 'friends';
    try {
      const entries = which === 'groups' ? S.captureGroups() : S.captureProfiles();
      if (!entries.length) return { found: 0, added: 0, total: 0 };

      const { added, total } = await storage.mergeIndex(which, entries);
      lastCapture = { mode: which, added, total, at: Date.now() };
      return { found: entries.length, added, total };
    } catch {
      return { found: 0, added: 0, total: 0, failed: true };
    }
  }

  FBF.indexCapture = {
    start,
    stop,
    capture,
    captureNow,
    getMode: () => mode,
    getLast: () => lastCapture,
  };
})(globalThis.FBF);
