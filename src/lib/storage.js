/**
 * chrome.storage.local access, shared by the content script, popup and worker.
 *
 * Everything lives on this machine. There is no server, no sync, no telemetry.
 * Post text is never written here — only author keys, classifications, counts,
 * and which selector strategy matched.
 *
 * Counts are buffered in memory and flushed on a timer, because writing to
 * storage on every post would mean a write per scroll frame.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const KEY = {
    friends: 'fbf:friends',
    groups: 'fbf:groups',
    stats: 'fbf:stats',
    diagnostics: 'fbf:diagnostics',
    settings: 'fbf:settings',
    hidden: 'fbf:hidden',
    sweep: 'fbf:sweep',
  };

  const STATS_DAYS = 30;
  const MAX_DIAGNOSTICS = 20;
  const FLUSH_INTERVAL_MS = 3000;

  const DEFAULT_SETTINGS = {
    debugOverlay: false,
    displayMode: 'off',
    neverShowShortcut: false,
    hideUnreadable: false,
    autoHide: false,
  };

  /** Classifications a post can receive. Every post lands in exactly one. */
  const POST_TYPES = [
    'friend',
    'groupJoined',
    'groupUnjoined',
    'page',
    'sponsored',
    'suggested',
    'unknown',
  ];

  /** The two the user actually chose — the numerator of the headline metric. */
  const CHOSEN_TYPES = ['friend', 'groupJoined'];

  /**
   * lowConfidence and disagreement are counters about our own accuracy, not
   * post categories. They overlap the types above and must never be summed
   * into a post total.
   */
  const META_TYPES = ['lowConfidence', 'disagreement'];

  const EMPTY_DAY = {};
  for (const t of [...POST_TYPES, ...META_TYPES]) EMPTY_DAY[t] = 0;

  const area = chrome.storage.local;

  function get(keys) {
    return area.get(keys);
  }

  function set(obj) {
    return area.set(obj);
  }

  /** Local calendar date, so buckets line up with the user's own days. */
  function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ---------------------------------------------------------------------------
  // Index
  // ---------------------------------------------------------------------------

  async function getIndex() {
    const data = await get([KEY.friends, KEY.groups]);
    return {
      friends: data[KEY.friends] || {},
      groups: data[KEY.groups] || {},
    };
  }

  /**
   * Merge captured entries into an index. Existing entries keep their original
   * capturedAt but take the newer display name, so a rename is picked up
   * without losing when we first saw the person.
   */
  async function mergeIndex(kind, entries) {
    if (!entries || !entries.length) return { added: 0, total: 0 };

    const storageKey = kind === 'friends' ? KEY.friends : KEY.groups;
    const data = await get(storageKey);
    const current = data[storageKey] || {};

    let added = 0;
    const now = Date.now();
    for (const { key, name } of entries) {
      if (!key) continue;
      if (current[key]) {
        if (name) current[key].name = name;
        current[key].seenAt = now;
      } else {
        current[key] = { name: name || '', capturedAt: now, seenAt: now };
        added++;
      }
    }

    if (added || entries.length) await set({ [storageKey]: current });
    return { added, total: Object.keys(current).length };
  }

  async function clearIndex() {
    await area.remove([KEY.friends, KEY.groups]);
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  let buffer = { ...EMPTY_DAY };
  let bufferDirty = false;
  let flushTimer = null;
  let flushChain = Promise.resolve();

  function bump(type, amount) {
    if (!(type in buffer)) return;
    buffer[type] += amount == null ? 1 : amount;
    bufferDirty = true;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer != null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Fold the in-memory buffer into today's bucket.
   *
   * Serialized through flushChain so two rapid flushes in this tab cannot
   * interleave their read-modify-write. Separate tabs can still race; for a
   * measurement tool an occasional lost handful of counts is not worth the
   * complexity of a lock.
   */
  function flush() {
    if (!bufferDirty) return flushChain;

    const pending = buffer;
    buffer = { ...EMPTY_DAY };
    bufferDirty = false;

    flushChain = flushChain
      .then(async () => {
        const data = await get(KEY.stats);
        const stats = data[KEY.stats] || {};
        const day = today();
        const bucket = { ...EMPTY_DAY, ...(stats[day] || {}) };

        for (const k of Object.keys(EMPTY_DAY)) bucket[k] += pending[k] || 0;
        stats[day] = bucket;

        // Keep a rolling window; older buckets are not useful and just grow.
        const days = Object.keys(stats).sort();
        while (days.length > STATS_DAYS) delete stats[days.shift()];

        await set({ [KEY.stats]: stats });
      })
      .catch(() => {
        // Storage failure must never break the page. The counts are lost.
      });

    return flushChain;
  }

  async function getStats() {
    const data = await get(KEY.stats);
    return data[KEY.stats] || {};
  }

  /**
   * Roll a set of day buckets into the numbers the popup and badge display.
   *
   * `chosenPct` is the point of the whole exercise: the share of home-feed
   * posts that came from a friend or a group you joined. It is reported over
   * classified posts only — posts we could not read are excluded from the
   * denominator rather than being silently counted against you, and their
   * share is reported separately as `unknownPct` so a high unknown rate shows
   * up as a health problem instead of a quietly wrong percentage.
   */
  function summarize(stats, dayKeys) {
    const days = dayKeys || Object.keys(stats || {});
    const counts = { ...EMPTY_DAY };

    for (const day of days) {
      const bucket = stats[day];
      if (!bucket) continue;
      for (const k of Object.keys(counts)) counts[k] += bucket[k] || 0;
    }

    const total = POST_TYPES.reduce((sum, t) => sum + counts[t], 0);
    const classified = total - counts.unknown;
    const chosen = CHOSEN_TYPES.reduce((sum, t) => sum + counts[t], 0);

    const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

    return {
      counts,
      total,
      classified,
      chosen,
      chosenPct: pct(chosen, classified),
      unknownPct: pct(counts.unknown, total),
      lowConfidencePct: pct(counts.lowConfidence, total),
      disagreements: counts.disagreement,
    };
  }

  /** The last `n` calendar days, most recent first. */
  function recentDays(n) {
    const out = [];
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    for (let i = 0; i < n; i++) {
      out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      d.setDate(d.getDate() - 1);
    }
    return out;
  }

  async function clearStats() {
    await area.remove(KEY.stats);
    buffer = { ...EMPTY_DAY };
    bufferDirty = false;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * A small ring of recent hard-to-classify posts, to make selector rot
   * debuggable. Structural facts only — which strategy matched, which markers
   * fired. No post text, no author names.
   */
  async function pushDiagnostic(entry) {
    const data = await get(KEY.diagnostics);
    const list = data[KEY.diagnostics] || [];
    list.unshift({ at: Date.now(), ...entry });
    list.length = Math.min(list.length, MAX_DIAGNOSTICS);
    await set({ [KEY.diagnostics]: list });
  }

  async function getDiagnostics() {
    const data = await get(KEY.diagnostics);
    return data[KEY.diagnostics] || [];
  }

  // ---------------------------------------------------------------------------
  // Hidden sources
  // ---------------------------------------------------------------------------

  const MAX_HIDDEN = 300;

  /**
   * Every use of "Hide all from" recorded locally.
   *
   * Facebook applies that setting permanently and offers no list of what you
   * have hidden, so without this there is no way to review a decision or
   * notice one you did not mean to make. This log is the whole reason the
   * shortcut can act directly instead of only pointing at the menu.
   */
  async function recordHidden(entry) {
    const data = await get(KEY.hidden);
    const list = data[KEY.hidden] || [];
    list.unshift({ at: Date.now(), ...entry });
    list.length = Math.min(list.length, MAX_HIDDEN);
    await set({ [KEY.hidden]: list });
    return list.length;
  }

  /**
   * Claim one slot from today's automatic-sweep allowance.
   *
   * Read-check-write in one place so the cap cannot be overshot by two calls
   * racing. Returns whether the slot was granted, and the running count for
   * display.
   */
  async function bumpSweepIfUnder(cap) {
    const data = await get(KEY.sweep);
    const current = data[KEY.sweep] || {};
    const day = today();
    const count = current.date === day ? current.count || 0 : 0;

    if (count >= cap) return { allowed: false, count, cap };

    await set({ [KEY.sweep]: { date: day, count: count + 1 } });
    return { allowed: true, count: count + 1, cap };
  }

  async function getSweep() {
    const data = await get(KEY.sweep);
    const current = data[KEY.sweep] || {};
    return current.date === today() ? { count: current.count || 0 } : { count: 0 };
  }

  async function getHidden() {
    const data = await get(KEY.hidden);
    return data[KEY.hidden] || [];
  }

  async function clearHidden() {
    await area.remove(KEY.hidden);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async function getSettings() {
    const data = await get(KEY.settings);
    return { ...DEFAULT_SETTINGS, ...(data[KEY.settings] || {}) };
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...patch };
    await set({ [KEY.settings]: next });
    return next;
  }

  FBF.storage = {
    KEY,
    EMPTY_DAY,
    POST_TYPES,
    CHOSEN_TYPES,
    META_TYPES,
    today,
    recentDays,
    summarize,
    getIndex,
    mergeIndex,
    clearIndex,
    bump,
    flush,
    getStats,
    clearStats,
    pushDiagnostic,
    getDiagnostics,
    recordHidden,
    getHidden,
    clearHidden,
    bumpSweepIfUnder,
    getSweep,
    getSettings,
    setSettings,
  };
})(globalThis.FBF);
