/**
 * Automatic "Hide all from" across every unchosen source in the feed.
 *
 * This is the deliberate step past the one-click shortcut: the extension acts
 * on its own. That is a real change in kind, and the safeguards here exist
 * because of it — not to second-guess the decision, but because a loop that
 * writes account preferences needs to be well-behaved to work at all.
 *
 *  - **One source, once.** Sources are tracked by author or group key, so a
 *    page with forty posts is actioned once, not forty times. This is the
 *    difference between a few dozen actions and thousands.
 *  - **Serialised, never concurrent.** Facebook mounts one menu at a time in a
 *    single portal; overlapping attempts would click the wrong item.
 *  - **Paced, not hammered.** Several seconds between actions, jittered.
 *    Bursts of synthetic clicks are both more likely to break and more likely
 *    to be noticed.
 *  - **Only while you are looking.** Paused when the tab is hidden.
 *  - **Capped per day**, so a bug cannot run away with the account.
 *  - **Stops itself on repeated failure.** If the menu item stops being found,
 *    something has changed and continuing to click blindly is worse than
 *    stopping.
 *
 * Friends and joined groups are never touched here, by the same rule that
 * governs hiding — see filter.js.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const MIN_DELAY_MS = 4000;
  const MAX_DELAY_MS = 9000;
  const MENU_ATTEMPTS = 15;
  const MENU_POLL_MS = 100;
  /**
   * How many misses in a row before the sweep stops itself.
   *
   * The point is to catch Facebook changing the menu, not to be tripped by the
   * occasional post that simply does not offer the option. Three turned out to
   * be too tight: two ads in one feed nearly exhausted it on their own. Ads are
   * excluded now, but the threshold has room in it so that one odd post type
   * cannot cancel everything queued behind it.
   */
  const MAX_CONSECUTIVE_FAILURES = 5;

  /** A ceiling on a single day's actions. Raise it if it gets in the way. */
  const DAILY_CAP = 150;

  /**
   * What the sweep acts on — recurring sources, and deliberately not ads.
   *
   * Two reasons, and the second is the one that actually bit:
   *
   * Ads are not a recurring source. There is an endless supply of advertisers,
   * so hiding them one at a time buys nothing, while a page or a group is a
   * source that keeps coming back and is worth killing permanently.
   *
   * And Facebook's menu on an ad does not offer "Hide all from" at all — it
   * offers *Hide ad* and *Why am I seeing this?*. So every ad was a guaranteed
   * miss, and three misses in a row is what stops the sweep. Two ads in the
   * feed were enough to burn most of that budget and cancel everything queued
   * behind them, which read as "it hides a few things and then gives up".
   *
   * Ads are still dimmed or hidden locally by filter.js, which costs nothing
   * and is reversible. They simply are not worth an account write.
   */
  const SWEEPABLE = new Set(['page', 'suggested', 'groupUnjoined']);

  let enabled = false;
  let running = false;
  let paused = null; // a reason string once we stop ourselves
  let consecutiveFailures = 0;

  /** Sources already actioned, by key — survives reloads via the hidden log. */
  const done = new Set();

  /** Articles waiting their turn. */
  const queue = [];

  function setEnabled(value) {
    const next = Boolean(value);
    if (next === enabled) return;
    enabled = next;
    if (!enabled) {
      queue.length = 0;
      return;
    }
    paused = null;
    consecutiveFailures = 0;
    loadDone().then(pump);
  }

  function isEnabled() {
    return enabled;
  }

  function state() {
    return { enabled, paused, queued: queue.length, actioned: done.size };
  }

  /** Rebuild the "already done" set from what has been recorded before. */
  async function loadDone() {
    try {
      for (const entry of await FBF.storage.getHidden()) {
        const key = entry.key || entry.label;
        if (key) done.add(key);
      }
    } catch {
      /* an empty set only means some sources are revisited */
    }
  }

  /**
   * Identity of the source behind a post.
   *
   * The author or group key when we have one, because that is stable. Display
   * names are the fallback, but "Unnamed source" is deliberately not treated
   * as an identity — several unrelated pages would collapse into one and all
   * but the first would be skipped forever.
   */
  function sourceKey(article, result) {
    if (result.groupKey) return result.groupKey;
    if (result.authorKey) return result.authorKey;
    const label = FBF.actions.sourceLabel(article);
    return label && label !== 'Unnamed source' ? `name:${label}` : null;
  }

  /** Offer a post to the sweep. Called for every classified post. */
  function consider(article, result) {
    if (!enabled || paused) return;
    try {
      if (!FBF.filter.shouldAct(result)) return;
      if (!SWEEPABLE.has(result.type)) return;

      const key = sourceKey(article, result);
      if (!key || done.has(key)) return;

      // Claimed as soon as it is queued, so the same source appearing three
      // more times before its turn does not queue three more times.
      done.add(key);
      queue.push({ article, key, type: result.type });
      pump();
    } catch {
      /* a post we cannot queue is simply not swept */
    }
  }

  function jitteredDelay() {
    return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
  }

  async function pump() {
    if (running || !enabled || paused) return;
    running = true;

    try {
      while (queue.length && enabled && !paused) {
        if (document.hidden) break; // resumed by the visibility listener

        const cap = await FBF.storage.bumpSweepIfUnder(DAILY_CAP);
        if (!cap.allowed) {
          paused = `Daily limit of ${DAILY_CAP} reached. Resumes tomorrow.`;
          break;
        }

        const job = queue.shift();
        if (!job.article.isConnected) continue; // scrolled away and unmounted

        const ok = await hideSource(job);
        if (ok) {
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            paused =
              `Stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row — the ` +
              '"Hide all from" item was not found. Facebook may have changed it. ' +
              'Switch the sweep off and on again to retry.';
            break;
          }
        }

        await wait(jitteredDelay());
      }
    } catch {
      /* never throw into the page */
    } finally {
      running = false;
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Open one post's menu, click "Hide all from", record it. */
  async function hideSource(job) {
    const { article } = job;
    const menu = article.querySelector('[aria-haspopup="menu"]');
    if (!menu) return false;

    const label = FBF.actions.sourceLabel(article);
    menu.click();

    for (let attempt = 0; attempt < MENU_ATTEMPTS; attempt++) {
      await wait(MENU_POLL_MS);
      const items = document.querySelectorAll('[role="menuitem"], [role="menu"] [role="button"]');
      for (const item of items) {
        if (FBF.actions.HIDE_ALL.test((item.textContent || '').trim())) {
          item.click();
          try {
            await FBF.storage.recordHidden({
              label, key: job.key, type: job.type, at: Date.now(), auto: true,
            });
          } catch {
            /* the action happened; failing to log it must not undo it */
          }
          return true;
        }
      }
    }

    closeMenu();
    return false;
  }

  /** Leave no menu hanging open when an attempt comes to nothing. */
  function closeMenu() {
    try {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
      );
    } catch {
      /* no-op */
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pump();
  });

  FBF.sweeper = {
    setEnabled, isEnabled, consider, state, DAILY_CAP, SWEEPABLE, MAX_CONSECUTIVE_FAILURES,
  };
})(globalThis.FBF);
