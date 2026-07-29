/**
 * Acting on the classification: dimming or hiding what you did not choose.
 *
 * The safety rule is the whole design here. Hiding is not symmetric with
 * showing: leaving an ad on screen costs a moment's irritation, while hiding a
 * friend's post means you never learn it existed and never find out you missed
 * it. So anything we are not sure about stays visible, always:
 *
 *  - `unknown` — we could not read the post, so we cannot judge it
 *  - low-confidence author matches — the author came from a loose fallback
 *
 * Only confidently-classified, definitely-unchosen posts are touched. Ads are
 * the exception to the confidence rule: a sponsored marker is proof in itself
 * and does not depend on having read the author.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const CHOSEN = new Set(['friend', 'groupJoined']);
  const MODES = new Set(['off', 'dim', 'hide']);

  const HIDDEN_FLAG = 'fbfHidden';
  const DIMMED_FLAG = 'fbfDimmed';

  let mode = 'off';

  function setMode(next) {
    const value = MODES.has(next) ? next : 'off';
    if (value === mode) return;
    mode = value;
    if (mode === 'off') restoreAll();
    else if (mode === 'dim') unhideAll();
    else undimAll();
  }

  function getMode() {
    return mode;
  }

  /** Would this post be acted on? Kept separate so the rule is readable. */
  /**
   * Whether posts we could not read at all are acted on. Off by default.
   *
   * These are the ones where nothing could be extracted — no author, no group,
   * no marker. A post we failed to parse is as likely to be a friend's as
   * anything else, so this stays opt-in.
   */
  let hideUnreadable = false;

  function setHideUnreadable(value) {
    hideUnreadable = Boolean(value);
  }

  /**
   * The costs here are not symmetric, and the first version treated them as
   * though they were.
   *
   * Missing a page you never followed costs nothing. Missing a friend's post
   * means never learning it existed. So uncertainty about *who a friend is*
   * still resolves towards leaving the post alone, while uncertainty about a
   * page does not need to.
   *
   * Concretely: a post with a readable author who is not in your index is
   * acted on even when the author came from a loose fallback. For that to hide
   * a friend, the fallback would have to have found a profile link in the post
   * that is not the author *and* the real author would have to be absent from
   * the index — whereas the ordinary case is that a friend's own link is the
   * first one in their own post. Posts with no readable author at all remain
   * protected, behind `hideUnreadable`.
   */
  /**
   * Act only on positive evidence that you are not connected to the source.
   *
   * The earlier rule acted on *absence from the index*, which is a much weaker
   * thing than it looks. The index knows your friends and the groups you
   * joined; it has no record of the pages you follow, and it goes stale for
   * groups the moment you join a new one. So "we have no record of this" was
   * convicting pages the user follows and groups they belong to — and in both
   * cases no Follow or Join button is shown, precisely *because* they are
   * already connected.
   *
   * Now something has to actively say otherwise: a Follow button, a Join
   * button, a "Suggested for you" label, or a sponsored marker. Facebook does
   * not offer to follow what you already follow.
   *
   * The cost is that an unchosen source showing no button at all survives.
   * That is the right way round: the failure is then a post you did not want,
   * which you can see and dismiss, rather than a post you did want, which you
   * never learn existed.
   */
  function shouldAct(result) {
    if (CHOSEN.has(result.type)) return false;

    // Nothing could be read from these, so no evidence exists either way —
    // governed by their own opt-in rather than by proof.
    if (result.type === 'unknown') return hideUnreadable;

    return Boolean(result.proven);
  }

  function apply(article, result) {
    try {
      if (mode === 'off' || !shouldAct(result)) {
        restore(article);
        return;
      }
      if (mode === 'hide') hide(article);
      else dim(article);
    } catch {
      // Never let presentation break the page.
    }
  }

  function hide(article) {
    if (article.dataset[HIDDEN_FLAG]) return;
    undim(article);
    article.dataset[HIDDEN_FLAG] = '1';
    article.style.setProperty('display', 'none', 'important');
  }

  function dim(article) {
    if (article.dataset[DIMMED_FLAG]) return;
    unhide(article);
    article.dataset[DIMMED_FLAG] = '1';
    article.style.setProperty('opacity', '0.35', 'important');
    article.style.setProperty('filter', 'grayscale(1)', 'important');
  }

  function unhide(article) {
    if (!article.dataset[HIDDEN_FLAG]) return;
    delete article.dataset[HIDDEN_FLAG];
    article.style.removeProperty('display');
  }

  function undim(article) {
    if (!article.dataset[DIMMED_FLAG]) return;
    delete article.dataset[DIMMED_FLAG];
    article.style.removeProperty('opacity');
    article.style.removeProperty('filter');
  }

  function restore(article) {
    unhide(article);
    undim(article);
  }

  function unhideAll() {
    for (const el of document.querySelectorAll(`[data-${'fbf-hidden'}]`)) unhide(el);
  }

  function undimAll() {
    for (const el of document.querySelectorAll(`[data-${'fbf-dimmed'}]`)) undim(el);
  }

  function restoreAll() {
    unhideAll();
    undimAll();
  }

  FBF.filter = {
    setMode, getMode, setHideUnreadable, apply, shouldAct, restoreAll, MODES,
  };
})(globalThis.FBF);
