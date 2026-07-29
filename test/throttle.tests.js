/**
 * The scheduling rule behind index capture.
 *
 * This is not a style preference. A debounce here does not run at all on
 * Facebook: the page mutates continuously, so every pending pass is cancelled
 * before it fires and the index freezes at whatever the first screenful held.
 * The distinction is worth a test because both shapes look correct in review
 * and only one of them survives a page that never stops changing.
 *
 * The scheduler is re-implemented here rather than imported, because the real
 * one is bound to a MutationObserver and chrome.storage. What is being pinned
 * is the rule — continuous activity must produce passes, not prevent them.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;

  /** A clock we control, so the test does not depend on real time passing. */
  function fakeScheduler(minInterval) {
    let now = 0;
    let timer = null;
    let timerDueAt = 0;
    let lastRunAt = 0;
    let runs = 0;

    function request() {
      if (timer != null) return; // already scheduled
      const wait = Math.max(0, minInterval - (now - lastRunAt));
      timer = true;
      timerDueAt = now + wait;
    }

    function advance(ms) {
      const target = now + ms;
      while (timer != null && timerDueAt <= target) {
        now = timerDueAt;
        timer = null;
        lastRunAt = now;
        runs++;
      }
      now = target;
    }

    return { request, advance, runs: () => runs };
  }

  /** The shape that used to be here, for contrast. */
  function fakeDebouncer(delay) {
    let now = 0;
    let dueAt = null;
    let runs = 0;

    function request() {
      dueAt = now + delay; // every request pushes the deadline back
    }

    function advance(ms) {
      const target = now + ms;
      if (dueAt != null && dueAt <= target) {
        now = dueAt;
        dueAt = null;
        runs++;
      }
      now = target;
    }

    return { request, advance, runs: () => runs };
  }

  /** Mutations arriving faster than the interval, as on a real Facebook page. */
  function stormOf(scheduler, { everyMs, forMs }) {
    for (let elapsed = 0; elapsed < forMs; elapsed += everyMs) {
      scheduler.request();
      scheduler.advance(everyMs);
    }
  }

  test('continuous mutation still produces capture passes', () => {
    const s = fakeScheduler(800);
    stormOf(s, { everyMs: 100, forMs: 10000 });
    assert.ok(s.runs() >= 10, `expected roughly one pass per 800ms, got ${s.runs()}`);
  });

  test('a debounce would never run under the same storm', () => {
    // The bug, demonstrated: this is why the index froze at one screenful.
    const d = fakeDebouncer(600);
    stormOf(d, { everyMs: 100, forMs: 10000 });
    assert.equal(d.runs(), 0, 'a debounce is starved by continuous mutation');
  });

  test('passes are not more frequent than the interval', () => {
    const s = fakeScheduler(800);
    stormOf(s, { everyMs: 10, forMs: 8000 });
    assert.ok(s.runs() <= 11, `should throttle, got ${s.runs()} passes in 8s`);
  });

  test('a single quiet mutation still triggers one pass', () => {
    const s = fakeScheduler(800);
    s.request();
    s.advance(900);
    assert.equal(s.runs(), 1);
  });

  test('idle time produces no passes', () => {
    const s = fakeScheduler(800);
    s.advance(10000);
    assert.equal(s.runs(), 0);
  });
})();
