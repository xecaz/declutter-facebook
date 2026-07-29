/**
 * Decide what a post is.
 *
 * The allowlist is the primary mechanism: is this author someone I friended,
 * or is this a group I joined? That question is answered against an index the
 * user built themselves, so it stays correct when Facebook invents a new kind
 * of injected content, and it works the same in any interface language.
 *
 * The visible markers ("Sponsored", "Suggested for you", a Follow button) are
 * only a cross-check. They are English-only and Facebook actively obfuscates
 * the sponsored label, so nothing load-bearing hangs off them. Where the two
 * disagree, we count the disagreement — that is a signal about our own
 * accuracy, and it is one of the things this phase exists to measure.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const S = FBF.selectors;

  /**
   * @returns {{
   *   type: 'friend'|'groupJoined'|'groupUnjoined'|'page'|'sponsored'|'suggested'|'unknown',
   *   authorKey: string|null, groupKey: string|null, storyKey: string|null,
   *   strategy: string, confident: boolean, markers: object, disagreement: boolean
   * }}
   */
  function classify(article, index) {
    const markers = S.detectMarkers(article);
    const author = S.findAuthor(article);
    const group = S.findGroup(article);
    const storyKey = S.findStory(article);

    const authorKey = author ? author.key : null;
    const groupKey = group ? group.key : null;
    const strategy = author ? author.strategy : 'none';
    const confident = author ? author.confident : false;

    const type = decide({ markers, authorKey, groupKey, index });

    // The allowlist says this is yours, but the page labelled it as injected.
    // Usually one of two things: an author link was misread, or the post
    // surfaced only because of someone else's activity ("X commented on this")
    // rather than because you follow whoever wrote it.
    //
    // Sponsored is not checked here — decide() returns early on it, so a
    // sponsored post can never also be 'friend' and the test would be dead.
    const chosen = type === 'friend' || type === 'groupJoined';
    const disagreement = chosen && (markers.suggested || markers.attribution);

    // Evidence that stands on its own, independent of having read the author:
    // a sponsored marker, or an offer to connect. Facebook does not offer to
    // follow someone you already follow, or to join a group you are in.
    //
    // Which offer counts depends on the post. For a group, only a *Join*
    // button proves non-membership — a group you belong to can still show a
    // Follow control for its posts, so accepting Follow here would convict a
    // group you are in.
    // Positive evidence that you are not connected to this source. Note it is
    // evidence of a *fact about the page*, not merely absence from our index.
    //
    // That distinction is the whole point. The index holds friends and the
    // groups you joined — it has no record of pages you follow. So "not in the
    // index" was quietly convicting every page the user had deliberately
    // followed, and those pages show no Follow button precisely because they
    // are already followed. Absence of a record is not evidence of absence.
    //
    // Which button counts depends on the post: Join for a group, Follow
    // otherwise. A "Suggested for you" label is evidence in its own right.
    const proven =
      !chosen &&
      Boolean(
        markers.sponsored ||
          markers.suggested ||
          (groupKey ? markers.joinButton : markers.followButton),
      );

    // A group missing from the index, with nothing offering to let you join.
    //
    // The index is built by hand from /groups/joins, so it goes stale: a group
    // joined since the last capture, or missed on the scroll, looks exactly
    // like a group you were never in. Without a Join button there is no
    // independent evidence either way, and dimming a group you are a member of
    // is the same silent loss as dimming a friend.
    const uncertainMembership = type === 'groupUnjoined' && !markers.joinButton;

    return {
      type, authorKey, groupKey, storyKey, strategy, confident, markers,
      disagreement, proven, uncertainMembership,
    };
  }

  function decide({ markers, authorKey, groupKey, index }) {
    // Ads are never anything else, and misfiling one as a friend post would
    // flatter the headline number.
    if (markers.sponsored) return 'sponsored';

    // A group you joined is content you signed up for, whoever wrote it.
    if (groupKey && index.groups[groupKey]) return 'groupJoined';

    // A friend is a friend wherever they post.
    //
    // This has to come before the unjoined-group test, and originally did not.
    // Group context was treated as beating authorship in both directions,
    // which is right one way — a stranger in a group you joined is still
    // yours — and plainly wrong the other. It meant a friend's post in a group
    // you happen not to be in was filed as unchosen and dimmed, which is
    // exactly the silent loss the whole safety rule exists to prevent. You
    // chose the person; the group they posted in does not undo that.
    if (authorKey && index.friends[authorKey]) return 'friend';

    // A group you are not in, posted by someone you have not friended.
    if (groupKey) return 'groupUnjoined';

    if (markers.suggested) return 'suggested';

    // A Follow or Join button means this is not from anyone you follow, which
    // is a firmer answer than the author link would have given us anyway. It
    // settles posts whose author cannot be read, which would otherwise fall
    // through to 'unknown' and be treated as unjudgeable.
    if (markers.followButton) return 'page';

    // A resolvable author who is not in the index: a page, a stranger, or a
    // friend we have not captured yet. Grouped as 'page' — not chosen, but
    // distinguished from posts we could not read at all.
    if (authorKey) return 'page';

    return 'unknown';
  }

  /**
   * Structural notes for the diagnostics ring. Deliberately free of names,
   * keys and post text — enough to debug selector rot, nothing more.
   */
  function diagnose(result) {
    return {
      type: result.type,
      strategy: result.strategy,
      confident: result.confident,
      hadAuthor: Boolean(result.authorKey),
      hadGroup: Boolean(result.groupKey),
      hadStory: Boolean(result.storyKey),
      markers: result.markers,
      selectorsVersion: S.SELECTORS_VERSION,
    };
  }

  FBF.classify = { classify, diagnose };
})(globalThis.FBF);
