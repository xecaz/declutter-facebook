/**
 * The whole interface: what the feed is made of, and every control over what
 * happens to it.
 *
 * Names in the index come from Facebook's DOM, so every value rendered here
 * goes in through textContent. No innerHTML anywhere in this file.
 */
(function () {
  'use strict';

  const storage = globalThis.FBF.storage;

  /**
   * These count *posts in the home feed*, not people in the index. The two
   * were both labelled "Friends" at first, in different sections, which reads
   * as the index being empty when it is the feed that has not been scrolled.
   * Hence "From …".
   */
  const LABELS = {
    friend: 'From friends',
    groupJoined: 'From groups you joined',
    groupUnjoined: 'From groups you have not joined',
    page: 'From pages and strangers',
    sponsored: 'Sponsored',
    suggested: 'Suggested',
    unknown: 'Could not read',
  };

  /** Above this share of unreadable posts, the numbers stop being trustworthy. */
  const UNKNOWN_WARN_PCT = 10;

  /** Below this many posts, a percentage is noise dressed up as a measurement. */
  const MIN_SAMPLE = 5;

  let range = 'today';

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function days() {
    return range === 'today' ? [storage.today()] : storage.recentDays(7);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Ask the active tab what it is doing.
   *
   * chrome.tabs.query works without the "tabs" permission — it just withholds
   * the URL, and we only need the id. The content script reports its own
   * location, so no extra permission is needed to know where we are.
   *
   * A rejected sendMessage means nothing is listening: either not a Facebook
   * page, or a Facebook page that was already open when the extension was
   * loaded or reloaded. Chrome only injects content scripts into pages loaded
   * afterwards, so that tab is genuinely not running the extension until it is
   * reloaded — which is the single most confusing way this can appear broken.
   */
  async function tabStatus() {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    } catch (error) {
      return { state: 'unreachable', why: String((error && error.message) || error) };
    }
    if (!tab || tab.id == null) return { state: 'unreachable', why: 'No active tab found.' };

    // Retried before concluding absence. A content script is injected at
    // document_idle, so a popup opened while a heavy page is still coming up
    // finds nothing listening yet — which is a different thing from the
    // extension not running there, and used to be reported as the latter.
    let why = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { type: 'fbf:status' });
        if (reply) return { state: 'ok', tabId: tab.id, ...reply };
        why = 'The tab replied with nothing.';
      } catch (error) {
        why = String((error && error.message) || error);
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return { state: 'unreachable', why };
  }

  function renderStatus(status) {
    const node = $('status');
    clear(node);

    const lamp = el('span', 'lamp');
    const text = el('span', 'text');
    node.appendChild(lamp);
    node.appendChild(text);

    if (status.state === 'unreachable') {
      node.className = 'status blocked';
      text.appendChild(el('strong', null, 'No reply from this tab. '));
      text.appendChild(
        document.createTextNode(
          'Check the address bar is a facebook.com page, then reload it — the extension ' +
            'only starts on pages opened after it was loaded.',
        ),
      );
      // The underlying reason, rather than one confident guess at it.
      if (status.why) text.appendChild(el('div', 'last-pass', status.why));
      return;
    }

    // The script answered but could not do its job. Naming which part failed
    // beats reporting it as absent, which is what used to happen.
    if (status.fatal || (status.missingModules && status.missingModules.length)) {
      node.className = 'status blocked';
      text.appendChild(el('strong', null, 'Running, but broken in this tab. '));
      if (status.missingModules && status.missingModules.length) {
        text.appendChild(
          document.createTextNode(`These parts failed to load: ${status.missingModules.join(', ')}.`),
        );
      }
      if (status.fatal) text.appendChild(el('div', 'last-pass', status.fatal));
      return;
    }

    if (status.onHomeFeed) {
      const feed = status.feed;

      // Posts on the page but no author read from any of them: the feed
      // selectors are wrong. Say which part, rather than "markup changed".
      if (feed && feed.articlesTopLevel > 0 && feed.withAuthor === 0) {
        node.className = 'status blocked';
        text.appendChild(el('strong', null, 'Finding posts, but cannot read who wrote them. '));
        text.appendChild(feedDiagnosticsBlock(feed));
        return;
      }

      if (feed && feed.articlesTopLevel === 0) {
        node.className = 'status blocked';
        text.appendChild(el('strong', null, 'On the home feed, but finding no posts. '));
        text.appendChild(feedDiagnosticsBlock(feed));
        return;
      }

      node.className = 'status live';
      text.appendChild(el('strong', null, 'Counting the home feed. '));
      if (feed) {
        text.appendChild(
          document.createTextNode(
            `${feed.articlesTopLevel} posts on screen, ${feed.withAuthor} with a readable author.`,
          ),
        );
      }
      return;
    }

    const profiles = status.profiles || 0;
    const groups = status.groups || 0;

    if (status.captureMode) {
      // On a page we recognise but reading nothing from it: the route rules are
      // right and the selectors are wrong.
      const seen = status.captureMode === 'friends' ? profiles : groups;
      if (!seen) {
        node.className = 'status blocked';
        text.appendChild(el('strong', null, 'On the right page, but reading nothing. '));
        text.appendChild(
          document.createTextNode(`Here is what this page looks like from inside ${status.pathname}:`),
        );
        text.appendChild(diagnosticsBlock(status.diagnostics));
        return;
      }

      node.className = 'status live';
      const what = status.captureMode === 'friends' ? 'friends' : 'groups';
      text.appendChild(el('strong', null, `Capturing ${what}. `));
      text.appendChild(
        document.createTextNode(`${seen} on the page now — scroll to the bottom of the list.`),
      );

      // Whether capture is *still* running is otherwise invisible: a scheduler
      // that has stopped firing looks exactly like a page with nothing new on
      // it, and that is how the index quietly froze at one screenful.
      const last = status.lastCapture;
      if (last && last.at) {
        text.appendChild(
          el(
            'div',
            'last-pass',
            `Last pass ${relativeTime(last.at)}: saw ${last.found}, added ${last.added}.`,
          ),
        );
      }
      return;
    }

    // Route not recognised. If the page is nonetheless full of profile or group
    // links, say so and offer to take them — a renamed Facebook URL should not
    // look the same as a broken extension.
    if (profiles > 2 || groups > 2) {
      node.className = 'status idle';
      text.appendChild(document.createTextNode('Not a page I capture from automatically, but '));
      text.appendChild(el('code', null, status.pathname || '?'));
      text.appendChild(
        document.createTextNode(
          ` has ${profiles} profile and ${groups} group links on it right now.`,
        ),
      );

      if (profiles > 2) text.appendChild(captureButton(status, 'friends', profiles));
      if (groups > 2) text.appendChild(captureButton(status, 'groups', groups));
      return;
    }

    node.className = 'status idle';
    text.appendChild(document.createTextNode('Nothing to do on '));
    text.appendChild(el('code', null, status.pathname || '?'));
    text.appendChild(document.createTextNode('. Open the home feed, or one of the pages below.'));
  }

  /**
   * The shape of the page, when capture comes back empty.
   *
   * Structure only — counts of links and regions, never a name or a URL. It is
   * meant to be read out loud to whoever is fixing the selectors, so it says
   * which of the possible causes it is rather than that something went wrong.
   */
  function diagnosticsBlock(diagnostics) {
    const box = el('div', 'diag');
    if (!diagnostics) {
      box.appendChild(el('div', null, 'No diagnostics — reload the Facebook tab.'));
      return box;
    }

    if (diagnostics.failed) {
      box.appendChild(el('div', null, `Reading the page threw: ${diagnostics.failed}`));
      return box;
    }

    const line = (k, v) => {
      const d = el('div', 'diag-row');
      d.appendChild(el('span', null, k));
      d.appendChild(el('span', 'n', String(v)));
      box.appendChild(d);
    };

    line('links on the page', diagnostics.anchorsInDoc);
    line('links inside role="main"', diagnostics.hasMain ? diagnostics.anchorsInMain : 'no main');
    line('profile links found', diagnostics.profilesInDoc);
    line('…of those, inside main', diagnostics.profilesInMain);
    line('group links found', diagnostics.groupsInDoc);
    line('role="link" elements', diagnostics.roleLinks);

    const verdict = el('div', 'diag-verdict');
    if (diagnostics.anchorsInDoc === 0) {
      verdict.textContent =
        'No links at all — the page had not rendered yet. Reopen this popup.';
    } else if (diagnostics.profilesInDoc === 0 && diagnostics.roleLinks > 20) {
      verdict.textContent =
        'Plenty of links, none of them ordinary profile URLs, and many role="link" elements. ' +
        'Facebook is likely rendering rows as clickable divs rather than anchors.';
    } else if (diagnostics.profilesInDoc === 0) {
      verdict.textContent =
        'Links exist but none parse as profiles — the URL shapes in keys.js are out of date.';
    } else if (diagnostics.profilesInMain === 0) {
      verdict.textContent =
        'Profiles exist on the page but none inside role="main" — the list is rendered outside ' +
        'the region we search.';
    } else {
      verdict.textContent = 'Profiles were found; the failure is after parsing.';
    }
    box.appendChild(verdict);

    return box;
  }

  /** The same idea as diagnosticsBlock, for the counting half. */
  function feedDiagnosticsBlock(feed) {
    const box = el('div', 'diag');
    const line = (k, v) => {
      const d = el('div', 'diag-row');
      d.appendChild(el('span', null, k));
      d.appendChild(el('span', 'n', String(v)));
      box.appendChild(d);
    };

    line('role="feed" present', feed.hasFeedRole ? 'yes' : 'no');
    line('posts found', feed.articlesTopLevel);
    line('found via', feed.postSource || '?');
    line('role="article" elements', feed.articlesIncludingNested);
    line('…of those, non-empty', feed.usableRoleArticles);
    line('posts with a heading', feed.withHeading);
    line('posts with an author', feed.withAuthor);
    line('posts with a permalink', feed.withStory);
    line('links in the first post', feed.firstArticleAnchors);
    line('role="link" in the first post', feed.firstArticleRoleLinks);

    const verdict = el('div', 'diag-verdict');
    if (feed.articlesTopLevel === 0 && feed.usableRoleArticles === 0) {
      verdict.textContent =
        'No usable role="article" elements, and the structural fallback found no containers ' +
        'holding both a profile link and a permalink — so there are no posts on screen at all. ' +
        'Scroll the feed and reopen this.';
    } else if (feed.withHeading === 0) {
      verdict.textContent =
        'Posts have no h2/h3/h4 inside them. Author lookup is anchored on the heading, so it ' +
        'has nothing to start from — headerRegion needs a different anchor.';
    } else if (feed.firstArticleAnchors === 0) {
      verdict.textContent =
        'Posts contain no ordinary links at all, so the author cannot be read from an href.';
    } else {
      verdict.textContent =
        'Posts and links exist, but none of the links parse as a profile — the URL shapes in ' +
        'keys.js do not match what the feed uses.';
    }
    box.appendChild(verdict);
    return box;
  }

  /**
   * Manual capture. Deliberately states the count before acting, because on a
   * page that mixes in suggestions this is how strangers would get into the
   * allowlist — that should be a decision, not a side effect.
   */
  function captureButton(status, kind, count) {
    const wrap = el('div', 'capture-row');
    const button = el('button', 'ghost', `Add these ${count} ${kind} to my index`);
    button.type = 'button';

    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Capturing…';
      try {
        const result = await chrome.tabs.sendMessage(status.tabId, {
          type: 'fbf:capture',
          kind,
        });
        button.textContent = result && result.added
          ? `Added ${result.added} new`
          : 'Nothing new to add';
      } catch {
        button.textContent = 'Failed — reload the tab';
      }
      setTimeout(refresh, 900);
    });

    wrap.appendChild(button);
    return wrap;
  }

  function renderHeadline(summary) {
    const pct = $('pct');
    const sub = $('sub');

    if (summary.classified < MIN_SAMPLE) {
      pct.textContent = '—';
      pct.classList.add('none');
      sub.textContent =
        summary.total === 0
          ? 'No posts counted yet. Open your Facebook feed and scroll.'
          : `Only ${summary.total} post${summary.total === 1 ? '' : 's'} so far — keep scrolling.`;
      return;
    }

    pct.classList.remove('none');
    pct.textContent = `${summary.chosenPct}%`;
    sub.textContent = `${summary.chosen} of ${summary.classified} classified posts · ${summary.total} seen`;
  }

  function renderBreakdown(summary) {
    const bar = $('bar');
    const legend = $('legend');
    const hint = $('bar-hint');
    clear(bar);
    clear(legend);
    clear(hint);

    const total = summary.total;

    // All zeros here means the home feed has not been scrolled — which is a
    // different thing from an empty index, and used to look identical to it.
    if (total === 0) {
      hint.textContent =
        'Nothing counted yet. These fill in as you scroll your home feed — ' +
        'they are posts, not the people in your index.';
    }

    for (const type of storage.POST_TYPES) {
      const n = summary.counts[type];

      if (total > 0 && n > 0) {
        const seg = el('span');
        seg.style.width = `${(n / total) * 100}%`;
        seg.style.background = `var(--t-${type})`;
        seg.title = `${LABELS[type]}: ${n}`;
        bar.appendChild(seg);
      }

      const li = el('li');
      const dot = el('span', 'dot');
      dot.style.background = `var(--t-${type})`;
      li.appendChild(dot);
      li.appendChild(el('span', null, LABELS[type]));
      li.appendChild(el('span', 'n', String(n)));
      legend.appendChild(li);
    }
  }

  function renderIndex(index) {
    const rows = $('index-rows');
    const hint = $('index-hint');
    clear(rows);
    clear(hint);
    hint.className = 'hint';

    const friends = Object.values(index.friends);
    const groups = Object.values(index.groups);

    rows.appendChild(row('Friends indexed', String(friends.length)));
    rows.appendChild(row('Groups indexed', String(groups.length)));

    const updated = lastCapturedAt([...friends, ...groups]);
    if (updated) rows.appendChild(row('Last updated', relativeTime(updated)));

    if (!friends.length) {
      hint.appendChild(document.createTextNode('No friends indexed yet. Open '));
      hint.appendChild(link('All friends', 'https://www.facebook.com/friends/list'));
      hint.appendChild(
        document.createTextNode(' and scroll to the bottom — the list is read as it renders.'),
      );
      hint.className = 'hint warn';
      return;
    }

    if (!groups.length) {
      hint.appendChild(document.createTextNode('No groups indexed yet. Open '));
      hint.appendChild(link('Your groups', 'https://www.facebook.com/groups/joins'));
      hint.appendChild(document.createTextNode(' and scroll to the bottom.'));
      hint.className = 'hint warn';
      return;
    }

    // A quick sanity check on what actually got captured. If names you do not
    // recognise show up here, the friends page rendered suggestions alongside
    // real friends and the index needs clearing.
    const recent = [...friends]
      .sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0))
      .slice(0, 3)
      .map((f) => f.name)
      .filter(Boolean);

    if (recent.length) {
      hint.appendChild(document.createTextNode('Most recent: '));
      hint.appendChild(el('span', null, recent.join(', ')));
    }
  }

  /**
   * What you have hidden through the shortcut.
   *
   * Facebook applies "Hide all from" permanently and keeps no list, so this is
   * the only place a decision can be reviewed — or a mistaken one spotted.
   */
  const OPT_OUT_LABELS = {
    sponsored: 'Advertisers',
    page: 'Pages and people',
    suggested: 'Suggested sources',
    groupUnjoined: 'Groups',
  };

  function renderHidden(hidden) {
    const section = $('hidden-section');
    const rows = $('hidden-rows');
    const list = $('hidden-list');
    const hint = $('hidden-hint');
    clear(rows);
    clear(list);
    clear(hint);

    if (!hidden.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    // Distinct sources, not raw clicks: hiding the same page twice from two of
    // its posts is one source opted out of, and counting it twice would make
    // the running total flatter than the truth.
    const byLabel = new Map();
    const byType = {};
    for (const entry of hidden) {
      const label = entry.label || 'Unnamed source';
      if (!byLabel.has(label)) {
        byLabel.set(label, entry);
        const type = entry.type || 'page';
        byType[type] = (byType[type] || 0) + 1;
      }
    }

    const total = el('div', 'row');
    total.appendChild(el('span', 'k', 'Sources opted out of'));
    total.appendChild(el('span', 'v ok', String(byLabel.size)));
    rows.appendChild(total);

    for (const [type, label] of Object.entries(OPT_OUT_LABELS)) {
      if (!byType[type]) continue;
      rows.appendChild(row(label, String(byType[type])));
    }

    if (hidden.length !== byLabel.size) {
      rows.appendChild(row('Times clicked', String(hidden.length)));
    }

    for (const entry of Array.from(byLabel.values()).slice(0, 5)) {
      const li = el('li');
      li.appendChild(el('span', 'who', entry.label || 'Unnamed source'));
      li.appendChild(el('span', 'when', relativeTime(entry.at)));
      list.appendChild(li);
    }

    hint.appendChild(
      document.createTextNode('Facebook keeps no list of these — this is the only record. '),
    );
    hint.appendChild(
      document.createTextNode('To undo one: Settings → News Feed → Reconnect on Facebook.'),
    );
  }

  /**
   * How the automatic sweep is doing, and why it might have stopped.
   *
   * A loop that writes account preferences must never be silently idle: not
   * running looks identical to nothing left to do, and the difference matters
   * a great deal here.
   */
  function renderSweep(settings, sweep, status) {
    const hint = $('sweep-hint');
    clear(hint);
    hint.className = 'hint';

    if (!settings.autoHide) return;

    const state = status && status.sweep;
    if (state && state.paused) {
      hint.className = 'hint warn';
      hint.textContent = state.paused;
      return;
    }

    const parts = [`${sweep.count} hidden today`];
    if (state && state.queued) parts.push(`${state.queued} queued`);
    parts.push('one action every few seconds, only while this tab is visible');
    hint.textContent = `${parts.join(' · ')}.`;
  }

  function renderHealth(summary, diagnostics) {
    const rows = $('health-rows');
    const hint = $('health-hint');
    clear(rows);
    clear(hint);
    hint.className = 'hint';

    const unknown = summary.unknownPct;
    const unknownRow = row('Posts we could not read', unknown == null ? '—' : `${unknown}%`);
    unknownRow.querySelector('.v').classList.add(
      unknown != null && unknown > UNKNOWN_WARN_PCT ? 'warn' : 'ok',
    );
    rows.appendChild(unknownRow);

    rows.appendChild(
      row(
        'Low-confidence author match',
        summary.lowConfidencePct == null ? '—' : `${summary.lowConfidencePct}%`,
      ),
    );
    rows.appendChild(row('Index vs. label disagreements', String(summary.disagreements)));

    if (unknown != null && unknown > UNKNOWN_WARN_PCT) {
      hint.className = 'hint warn';
      hint.textContent =
        'Facebook has probably changed its markup. The strategies in ' +
        'src/lib/selectors.js need updating — treat the percentage above as unreliable ' +
        'until this drops.';
      return;
    }

    if (summary.disagreements > 0) {
      hint.textContent =
        'Some posts counted as yours also carried a "Sponsored" or "Suggested" label. ' +
        'Worth spot-checking with the outline toggle below.';
      return;
    }

    if (diagnostics.length) {
      hint.textContent = `${diagnostics.length} recent post${
        diagnostics.length === 1 ? '' : 's'
      } logged for debugging (structure only, no content).`;
    }
  }

  function row(key, value) {
    const node = el('div', 'row');
    node.appendChild(el('span', 'k', key));
    node.appendChild(el('span', 'v', value));
    return node;
  }

  function link(text, href) {
    const a = el('a', null, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    return a;
  }

  function lastCapturedAt(entries) {
    let max = 0;
    for (const e of entries) {
      const t = e.seenAt || e.capturedAt || 0;
      if (t > max) max = t;
    }
    return max || null;
  }

  function relativeTime(ts) {
    const secs = Math.round((Date.now() - ts) / 1000);
    if (secs < 45) return `${Math.max(1, secs)}s ago`;
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const d = Math.round(hours / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  async function refresh() {
    const [stats, index, settings, diagnostics, hidden, sweep, status] = await Promise.all([
      storage.getStats(),
      storage.getIndex(),
      storage.getSettings(),
      storage.getDiagnostics(),
      storage.getHidden(),
      storage.getSweep(),
      tabStatus(),
    ]);

    const summary = storage.summarize(stats, days());

    renderStatus(status);
    renderHeadline(summary);
    renderBreakdown(summary);
    renderIndex(index);
    renderHidden(hidden);
    renderHealth(summary, diagnostics);

    $('debug-overlay').checked = Boolean(settings.debugOverlay);
    $('never-show-shortcut').checked = Boolean(settings.neverShowShortcut);
    $('hide-unreadable').checked = Boolean(settings.hideUnreadable);
    $('auto-hide').checked = Boolean(settings.autoHide);
    renderSweep(settings, sweep, status);
    renderMode(settings.displayMode || 'off', summary);
  }

  const MODE_HINTS = {
    off: 'Nothing is changed on the page. Counting only.',
    dim: 'Unchosen posts are greyed out but still readable.',
    hide: 'Unchosen posts are removed from the page.',
  };

  function renderMode(mode, summary) {
    for (const button of document.querySelectorAll('.modes button')) {
      button.classList.toggle('on', button.dataset.mode === mode);
    }

    const hint = $('mode-hint');
    clear(hint);
    hint.className = 'hint';
    hint.appendChild(document.createTextNode(MODE_HINTS[mode] || MODE_HINTS.off));

    if (mode !== 'off') {
      // The rule, stated where the decision is made rather than buried in a
      // readme: something must actively say you are not connected.
      hint.appendChild(document.createElement('br'));
      hint.appendChild(
        document.createTextNode(
          'Only posts showing a Follow or Join button, a “Suggested” label, or an ad marker ' +
            'are touched. Pages you already follow show no Follow button, so they are left alone.',
        ),
      );

      const affected =
        summary.counts.page + summary.counts.sponsored +
        summary.counts.suggested + summary.counts.groupUnjoined;
      if (summary.total > 0) {
        hint.appendChild(document.createElement('br'));
        hint.appendChild(
          document.createTextNode(
            `That is ${affected} of the ${summary.total} posts counted in this range.`,
          ),
        );
      }
    }
  }

  /** Destructive buttons ask once, in place, rather than through a dialog. */
  function confirmable(button, action) {
    let armed = false;
    const original = button.textContent;

    const disarm = () => {
      armed = false;
      button.textContent = original;
      button.removeAttribute('data-confirm');
    };

    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.textContent = 'Sure?';
        button.setAttribute('data-confirm', '1');
        setTimeout(disarm, 4000);
        return;
      }
      disarm();
      await action();
      await refresh();
    });
  }

  function init() {
    for (const button of document.querySelectorAll('.range button')) {
      button.addEventListener('click', () => {
        range = button.dataset.range;
        for (const b of document.querySelectorAll('.range button')) {
          b.classList.toggle('on', b === button);
        }
        refresh();
      });
    }

    $('debug-overlay').addEventListener('change', (event) => {
      storage.setSettings({ debugOverlay: event.target.checked });
    });

    $('never-show-shortcut').addEventListener('change', (event) => {
      storage.setSettings({ neverShowShortcut: event.target.checked });
    });

    $('hide-unreadable').addEventListener('change', (event) => {
      storage.setSettings({ hideUnreadable: event.target.checked });
    });

    $('auto-hide').addEventListener('change', async (event) => {
      await storage.setSettings({ autoHide: event.target.checked });
      refresh();
    });

    for (const button of document.querySelectorAll('.modes button')) {
      button.addEventListener('click', async () => {
        await storage.setSettings({ displayMode: button.dataset.mode });
        refresh();
      });
    }

    confirmable($('clear-stats'), () => storage.clearStats());
    confirmable($('clear-index'), () => storage.clearIndex());

    refresh();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
