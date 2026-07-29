/**
 * Bootstrap.
 *
 * Wires the scanner and the index capture to whatever page the user is on,
 * keeps an in-memory copy of the index and settings, and — above all — makes
 * sure that nothing in here can break Facebook. Every entry point is wrapped;
 * a failure degrades to counting nothing, never to a broken feed.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const S = FBF.selectors;
  const storage = FBF.storage;

  let index = { friends: {}, groups: {} };
  let lastHref = null;

  const guard = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  };

  async function loadIndex() {
    try {
      index = await storage.getIndex();
    } catch {
      index = { friends: {}, groups: {} };
    }
  }

  async function loadSettings() {
    try {
      const settings = await storage.getSettings();
      FBF.overlay.setEnabled(settings.debugOverlay);
      FBF.filter.setMode(settings.displayMode);
      FBF.actions.setEnabled(settings.neverShowShortcut);
      FBF.filter.setHideUnreadable(settings.hideUnreadable);
      FBF.sweeper.setEnabled(settings.autoHide);
    } catch {
      /* defaults are fine */
    }
  }

  /**
   * Route changes are soft: Facebook swaps the whole page without a reload, so
   * there is no navigation event to hang off. Polling the URL is crude but
   * cheap and it cannot be defeated by however Facebook happens to route.
   */
  function onRouteMaybeChanged() {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;
    applyRoute();
  }

  function applyRoute() {
    if (S.isHomeFeed()) {
      FBF.indexCapture.stop();
      // The feed is rebuilt from scratch on re-entry, so previously counted
      // posts will arrive as new nodes; the fingerprint set still catches them.
      FBF.scanner.start(() => index);
      FBF.scanner.requestScan();
    } else {
      FBF.scanner.stop();
      FBF.indexCapture.start();
    }
  }

  function watchStorage() {
    chrome.storage.onChanged.addListener(
      guard((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes[storage.KEY.friends] || changes[storage.KEY.groups]) {
          loadIndex();
        }
        if (changes[storage.KEY.settings]) {
          const next = changes[storage.KEY.settings].newValue || {};
          FBF.overlay.setEnabled(Boolean(next.debugOverlay));
          FBF.filter.setMode(next.displayMode);
          FBF.actions.setEnabled(next.neverShowShortcut);
          FBF.filter.setHideUnreadable(next.hideUnreadable);
          FBF.sweeper.setEnabled(next.autoHide);

          // Apply to what is already on screen rather than waiting for a
          // scroll. repaint(), not reset() — changing how posts are displayed
          // must not re-count posts that have already been counted.
          FBF.scanner.repaint();
          FBF.scanner.requestScan();
        }
        // Stats cleared from the popup: start counting from zero again, so the
        // fresh numbers describe this session rather than resuming mid-stream.
        if (changes[storage.KEY.stats] && !changes[storage.KEY.stats].newValue) {
          FBF.scanner.reset();
        }
      }),
    );
  }

  function watchLifecycle() {
    // Buffered counts are lost if the tab goes away between flushes.
    const flush = guard(() => storage.flush());
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener(
      'visibilitychange',
      guard(() => {
        if (document.visibilityState === 'hidden') storage.flush();
      }),
    );
  }

  /**
   * Answers the popup's "what is this tab doing?" question.
   *
   * Registered synchronously, before anything that can fail, so that a tab
   * where setup broke still answers rather than looking identical to a tab
   * with no content script at all.
   *
   * The absence of a reply is itself the most useful signal: Chrome only
   * injects content scripts into pages loaded *after* the extension, so a tab
   * that was already open when the extension was reloaded stays silent until
   * it is reloaded too. That is the single most confusing failure here, and
   * the popup can only report it if silence is distinguishable.
   */
  /** Which modules actually loaded, so a partial failure can be named. */
  function moduleHealth() {
    const expected = [
      'keys', 'selectors', 'storage', 'classify', 'overlay', 'filter', 'actions',
      'scanner', 'indexCapture', 'sweeper',
    ];
    return expected.filter((name) => !FBF[name]);
  }

  function buildStatus() {
    const status = {
      alive: true,
      pathname: location.pathname,
      host: location.hostname,
      missingModules: moduleHealth(),
    };

    // Each field is gathered separately. A single failing lookup used to take
    // the whole reply down with it, and a reply that never arrives is
    // indistinguishable from a content script that was never injected — so one
    // broken selector was reported to the user as "not running in this tab".
    const attempt = (name, fn) => {
      try {
        status[name] = fn();
      } catch (error) {
        status[name] = null;
        status.errors = status.errors || {};
        status.errors[name] = String((error && error.message) || error);
      }
    };

    attempt('onHomeFeed', () => S.isHomeFeed());
    attempt('captureMode', () => FBF.indexCapture.getMode());
    attempt('lastCapture', () => FBF.indexCapture.getLast());
    attempt('selectorsVersion', () => S.SELECTORS_VERSION);
    attempt('sweep', () => FBF.sweeper.state());

    // Only the survey relevant to where we are. Running every scan on every
    // page meant several full-document passes over a large feed on each popup
    // open, for numbers that page could not use.
    if (status.onHomeFeed) {
      attempt('feed', () => S.feedDiagnostics());
    } else {
      attempt('profiles', () => S.captureProfiles().length);
      attempt('groups', () => S.captureGroups().length);
      attempt('diagnostics', () => S.captureDiagnostics());
    }

    return status;
  }

  function watchMessages() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Wrapped whole. Whatever happens in here, something must go back, or
      // the popup can only conclude that nothing is listening.
      try {
        if (!message) return false;

        if (message.type === 'fbf:capture') {
          FBF.indexCapture
            .captureNow(message.kind)
            .then(sendResponse)
            .catch(() => sendResponse({ found: 0, added: 0, total: 0, failed: true }));
          return true; // response is async
        }

        if (message.type !== 'fbf:status') return false;

        sendResponse(buildStatus());
      } catch (error) {
        try {
          sendResponse({
            alive: true,
            fatal: String((error && error.message) || error),
            pathname: location.pathname,
            missingModules: moduleHealth(),
          });
        } catch {
          /* the port is gone; nothing more can be done */
        }
      }
      return false;
    });
  }

  async function main() {
    await Promise.all([loadIndex(), loadSettings()]);

    watchStorage();
    watchLifecycle();

    lastHref = location.href;
    applyRoute();

    window.addEventListener('popstate', guard(onRouteMaybeChanged));
    setInterval(guard(onRouteMaybeChanged), 500);
  }

  guard(watchMessages)();
  guard(main)();
})(globalThis.FBF);
