/**
 * Find posts, classify them once each, and count the result.
 *
 * The hard part here is not finding posts — it is not counting them twice.
 * Facebook virtualises the feed: posts are unmounted when they scroll out of
 * view and remounted as fresh nodes when they scroll back in, and React
 * re-renders nodes in place while you read. Counting naively inflates every
 * number, and inflates them unevenly, which would quietly poison the one
 * measurement this phase exists to produce.
 *
 * So dedup runs at two levels: node identity for the cheap case, and a content
 * fingerprint for the case where the same post comes back as a new node.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const S = FBF.selectors;
  const K = FBF.keys;
  const storage = FBF.storage;

  /** Nodes already handled. Weak so unmounted posts are collected normally. */
  let processedNodes = new WeakSet();

  /** Fingerprints of posts already counted, to survive remounting. */
  let countedPosts = new Set();

  /** A long session shouldn't grow this without bound. */
  const MAX_FINGERPRINTS = 5000;

  let observer = null;
  let pending = false;
  let running = false;
  let getIndex = () => ({ friends: {}, groups: {} });

  const schedule =
    typeof requestIdleCallback === 'function'
      ? (fn) => requestIdleCallback(fn, { timeout: 1000 })
      : (fn) => setTimeout(fn, 200);

  /**
   * A stable identity for a post, or null when we have nothing to identify it
   * by.
   *
   * The permalink is best — it carries the story id and survives remounting.
   * Failing that we hash the author, the group and the visible text.
   *
   * Returning null matters as much as the hash does. The first version fell
   * back to hashing author + header alone, so a post with no author, no group
   * and no readable header hashed to the same value as every *other* such
   * post. One unreadable post was counted and every unreadable post after it
   * was silently discarded as a duplicate — the feed total froze at 1 while
   * scrolling continued. A fingerprint that cannot distinguish two posts must
   * refuse to answer rather than collapse them.
   *
   * Text is hashed in memory and discarded; it is never written to storage.
   */
  function fingerprint(article, result) {
    if (result.storyKey) return result.storyKey;

    const header = S.headerText(article).replace(/\s+/g, ' ').trim();

    // The body distinguishes posts whose headers are identical boilerplate.
    let body = '';
    try {
      body = (article.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    } catch {
      body = '';
    }

    const parts = [result.authorKey || '', result.groupKey || '', header, body];
    if (!parts.join('').trim()) return null; // nothing distinguishing at all

    return K.hash(parts.join('|'));
  }

  function remember(fp) {
    if (countedPosts.size >= MAX_FINGERPRINTS) countedPosts.clear();
    countedPosts.add(fp);
  }

  function scan() {
    if (!running || !S.isHomeFeed()) return;

    const index = getIndex();
    let articles;
    try {
      articles = S.findArticles(document);
    } catch {
      return;
    }

    for (const article of articles) {
      if (processedNodes.has(article)) continue;
      processedNodes.add(article);

      let result;
      try {
        result = FBF.classify.classify(article, index);
      } catch {
        continue; // A post we cannot read is not worth breaking the scan over.
      }

      const fp = fingerprint(article, result);
      if (fp && countedPosts.has(fp)) {
        // Already counted, but a remounted node is a fresh element and needs
        // to be hidden and painted again.
        FBF.filter.apply(article, result);
        FBF.actions.attach(article, result);
        FBF.overlay.mark(article, result);
        continue;
      }
      // A null fingerprint means we cannot tell this post from another, so it
      // is counted on the strength of being a distinct node. The WeakSet still
      // stops the same node being counted twice; the cost is that a remount
      // may recount it, which is far better than discarding every post we
      // cannot identify.
      if (fp) remember(fp);

      storage.bump(result.type);
      if (!result.confident) storage.bump('lowConfidence');
      if (result.disagreement) storage.bump('disagreement');

      if (result.type === 'unknown' || !result.confident) {
        storage.pushDiagnostic(FBF.classify.diagnose(result)).catch(() => {});
      }

      FBF.filter.apply(article, result);
      FBF.sweeper.consider(article, result);
      FBF.actions.attach(article, result);
      FBF.overlay.mark(article, result);
    }
  }

  function requestScan() {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      try {
        scan();
      } catch {
        /* never throw into the page */
      }
    });
  }

  function start(indexGetter) {
    if (running) return;
    running = true;
    if (indexGetter) getIndex = indexGetter;

    // Facebook's feed mutates on essentially every frame while scrolling, so
    // every batch is coalesced into a single idle-time pass rather than
    // handled per mutation.
    observer = new MutationObserver(requestScan);
    observer.observe(S.findFeedContainer(), { childList: true, subtree: true });

    requestScan();
  }

  function stop() {
    running = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    storage.flush();
  }

  /**
   * Re-examine posts already on screen without counting them again.
   *
   * Only node identity is forgotten; the fingerprints stay, so the next pass
   * classifies each post afresh, finds its fingerprint already recorded, and
   * paints it without bumping any counter. Used when the debug overlay is
   * switched on — turning on a diagnostic must not change the measurement.
   */
  function repaint() {
    processedNodes = new WeakSet();
  }

  /** Forget everything, so posts on screen are counted again from scratch. */
  function reset() {
    processedNodes = new WeakSet();
    countedPosts = new Set();
  }

  FBF.scanner = { start, stop, reset, repaint, requestScan, isRunning: () => running };
})(globalThis.FBF);
