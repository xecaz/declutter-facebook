/**
 * The only file that knows what Facebook's DOM looks like.
 *
 * Everything else in this extension is written against the functions exported
 * here. Facebook reshapes its markup roughly weekly and its class names are
 * rotating hashes, so when this extension breaks, it breaks *here* — and this
 * is the only file that should need editing.
 *
 * Two rules kept this file honest:
 *  - Never match on a class name. They are generated and rotate.
 *  - Prefer ARIA roles and href shapes, which have to stay stable because
 *    Facebook's own accessibility and routing depend on them.
 *
 * Every lookup is layered: a precise strategy first, then progressively looser
 * fallbacks. Which strategy fired is reported back to the caller so that the
 * popup can show when we have quietly degraded to guessing.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const K = FBF.keys;

  /** Bump when the strategies below are revised, so stale stats are legible. */
  const SELECTORS_VERSION = '2026-07-29';

  const FEED = 'div[role="feed"]';
  const ARTICLE = 'div[role="article"]';
  const MAIN = 'div[role="main"]';

  // ---------------------------------------------------------------------------
  // Feed and post containers
  // ---------------------------------------------------------------------------

  /**
   * Top-level posts in the document.
   *
   * role="article" first, because when Facebook uses it, it is exact.
   * Comments carry the same role and live inside the post they belong to, so
   * any article with an article ancestor is dropped — and so is any article
   * with no links in it at all, because Facebook ships empty role="article"
   * placeholders that would otherwise be counted as unreadable posts forever.
   *
   * When that finds nothing, fall back to what a post structurally *is*
   * rather than what it is labelled: the smallest container holding both a
   * profile link and a permalink. That definition survives Facebook renaming
   * or dropping the role, which a selector on the role cannot.
   */
  function findArticles(root) {
    const scope = root && root.querySelectorAll ? root : document;

    const byRole = Array.from(scope.querySelectorAll(ARTICLE)).filter((el) => {
      const parent = el.parentElement;
      if (parent && parent.closest(ARTICLE)) return false; // a comment
      return el.querySelector('a[href]'); // not an empty placeholder
    });

    const posts = byRole.length ? byRole : findPostsStructurally(scope);

    // Ads carry no profile link at all — the advertiser is named in the menu's
    // accessible name, not in an href — so the structural pass, which anchors
    // on authorship and permalinks, cannot see them. Left out, they vanish
    // from the denominator entirely and the "share of the feed you chose" is
    // computed over a feed with no advertising in it, which flatters it badly.
    const ads = findSponsoredUnits(scope).filter(
      (ad) => !posts.some((post) => post.contains(ad) || ad.contains(post)),
    );

    return posts.concat(ads);
  }

  /**
   * Ad units, found by their menu rather than their authorship.
   *
   * Every post carries its own ⋯ menu. Growing outward from one menu while the
   * parent still contains no *other* menu yields the largest region belonging
   * to exactly one post — a definition that holds for ads, which have neither
   * an author link nor a permalink to anchor on.
   *
   * Only regions that actually carry a sponsored marker are returned, which is
   * what keeps page furniture (the navigation bar has menus too) out.
   */
  /**
   * One region per ⋯ menu: the largest area belonging to exactly one post.
   *
   * This is the most reliable structural anchor found so far, because every
   * post has its own menu whether or not it has an author, a permalink or a
   * heading. On a real feed it located every post including the ads, where
   * anchoring on authorship found less than half of them.
   */
  function findUnitsByMenu(scope) {
    const menus = Array.from(scope.querySelectorAll('[aria-haspopup="menu"]'));
    if (!menus.length) return [];

    const units = new Set();
    for (const menu of menus) {
      let node = menu;
      for (let depth = 0; depth < 30; depth++) {
        const parent = node.parentElement;
        if (!parent || parent === document.body) break;
        if (menus.some((other) => other !== menu && parent.contains(other))) break;
        node = parent;
      }
      units.add(node);
    }
    return Array.from(units);
  }

  /**
   * Does this region look like a post rather than page furniture?
   *
   * The navigation bar has menus too. A post carries at least one of: an
   * author, a permalink, a sponsored marker, or a Follow/Join button.
   */
  function looksLikePost(el) {
    try {
      if (hasProfileAnchor(el)) return true;
      for (const a of el.querySelectorAll('a[href]')) {
        try {
          if (K.storyKey(a.getAttribute('href'))) return true;
        } catch {
          /* keep looking */
        }
      }
      if (detectSponsored(el)) return true;
      if (detectFollowButton(el)) return true;
    } catch {
      return false;
    }
    return false;
  }

  function findSponsoredUnits(scope) {
    return findUnitsByMenu(scope).filter((el) => {
      try {
        return Boolean(detectSponsored(el));
      } catch {
        return false;
      }
    });
  }

  function hasProfileAnchor(el) {
    for (const a of el.querySelectorAll('a[href]')) {
      try {
        if (K.profileKey(a.getAttribute('href'))) return true;
      } catch {
        /* keep looking */
      }
    }
    return false;
  }

  /**
   * Posts identified by shape rather than by role.
   *
   * Anchored on permalinks because every real post has one and page furniture
   * does not. From each, walk outwards to the first ancestor that also
   * contains a profile link — that container is the post, whatever Facebook
   * has called it this week.
   *
   * Innermost wins. A post can hold several permalinks (the timestamp, a
   * shared story), which yields nested candidates; keeping the innermost
   * avoids swallowing a neighbouring post into one container and counting two
   * posts as one.
   */
  function findPostsStructurally(scope) {
    // The ⋯ menu is the better anchor: every post has one, including posts
    // with no author link and no permalink, which the permalink-anchored pass
    // below simply cannot see. Those unseen posts are why so much of the feed
    // went unclassified and therefore unhidden.
    const viaMenu = findUnitsByMenu(scope).filter(looksLikePost);
    if (viaMenu.length) {
      return viaMenu.filter((el) => !viaMenu.some((o) => o !== el && el.contains(o)));
    }

    return findPostsByPermalink(scope);
  }

  function findPostsByPermalink(scope) {
    const containers = new Set();

    for (const anchor of scope.querySelectorAll('a[href]')) {
      let isStory = false;
      try {
        isStory = Boolean(K.storyKey(anchor.getAttribute('href')));
      } catch {
        isStory = false;
      }
      if (!isStory) continue;

      let node = anchor.parentElement;
      for (let depth = 0; depth < 25 && node && node !== document.body; depth++) {
        if (hasProfileAnchor(node)) {
          containers.add(node);
          break;
        }
        node = node.parentElement;
      }
    }

    const list = Array.from(containers);
    return list.filter((el) => !list.some((other) => other !== el && el.contains(other)));
  }

  /**
   * The MutationObserver target for feed scanning.
   *
   * role="feed" when it exists, otherwise the whole document — deliberately
   * not role="main" in between. Facebook ships empty role="main" elements on
   * at least some pages, and an observer attached to a container that never
   * mutates never fires, so scanning would stop after the first pass with no
   * error to show for it.
   */
  function findFeedContainer() {
    return document.querySelector(FEED) || document.body;
  }

  /**
   * The header block of a post: author, group context, timestamp, menu.
   *
   * Anchored on the post's heading element, then climbed a few levels so the
   * group link and timestamp are inside the returned subtree too. Climbing is
   * bounded so a malformed post cannot hand back the whole article.
   */
  function headerRegion(article) {
    const heading = article.querySelector('h2, h3, h4');
    if (heading) {
      let node = heading;
      for (let i = 0; i < 3; i++) {
        const parent = node.parentElement;
        if (!parent || parent === article) break;
        node = parent;
      }
      return node;
    }
    return article.firstElementChild || article;
  }

  // ---------------------------------------------------------------------------
  // Author, group and permalink extraction
  // ---------------------------------------------------------------------------

  function anchorsIn(el) {
    return el ? Array.from(el.querySelectorAll('a[href]')) : [];
  }

  function firstKeyed(anchors, keyFn) {
    for (const a of anchors) {
      const key = keyFn(a.getAttribute('href'));
      if (key) return { anchor: a, key };
    }
    return null;
  }

  /**
   * Who posted this.
   *
   * Strategy order matters: the heading is where Facebook puts the author, so
   * a hit there is trustworthy. The looser fallbacks can pick up a mention or
   * a tagged friend instead, which is why the strategy name travels with the
   * result and a whole-article match is treated as low confidence.
   */
  function findAuthor(article) {
    const heading = article.querySelector('h2, h3, h4');

    const fromHeading = firstKeyed(anchorsIn(heading), K.profileKey);
    if (fromHeading) return { ...fromHeading, strategy: 'heading', confident: true };

    const fromHeader = firstKeyed(anchorsIn(headerRegion(article)), K.profileKey);
    if (fromHeader) return { ...fromHeader, strategy: 'header-region', confident: true };

    // Avatar links sit just outside the heading on some post shapes.
    const fromImage = firstKeyed(
      Array.from(article.querySelectorAll('a[href] image, a[href] img')).map((n) => n.closest('a[href]')),
      K.profileKey,
    );
    if (fromImage) return { ...fromImage, strategy: 'avatar', confident: true };

    const fromArticle = firstKeyed(anchorsIn(article), K.profileKey);
    if (fromArticle) return { ...fromArticle, strategy: 'article-scan', confident: false };

    return null;
  }

  /** Which group this was posted in, if any. */
  function findGroup(article) {
    const fromHeader = firstKeyed(anchorsIn(headerRegion(article)), K.groupKey);
    if (fromHeader) return { ...fromHeader, strategy: 'header-region' };

    const fromArticle = firstKeyed(anchorsIn(article), K.groupKey);
    if (fromArticle) return { ...fromArticle, strategy: 'article-scan' };

    return null;
  }

  /**
   * The post's own permalink — normally the timestamp link. Gives us a stable
   * story id for dedup across feed recycling.
   */
  function findStory(article) {
    const found = firstKeyed(anchorsIn(article), K.storyKey);
    return found ? found.key : null;
  }

  // ---------------------------------------------------------------------------
  // Marker detection (cross-check only)
  // ---------------------------------------------------------------------------

  /**
   * These phrases are a secondary signal, deliberately not load-bearing.
   *
   * Facebook actively obfuscates the "Sponsored" label — splitting it across
   * spans, interleaving hidden characters, reordering glyphs with CSS — to
   * defeat exactly this kind of matching, and the strings are English-only.
   * The headline metric never depends on them: it is driven by the index
   * allowlist, which needs no text at all. Markers exist so the popup can
   * report where the allowlist and the visible label disagree.
   */
  /**
   * Invisible characters Facebook pads labels with to defeat text matching.
   * The observed "Sponsored" label carries a trailing U+200B zero-width space.
   */
  const INVISIBLE = /[​-‍⁠﻿­]/g;

  function normalize(text) {
    return (text || '').replace(INVISIBLE, '');
  }

  /**
   * "Sponsored" across the languages Facebook's UI ships in. Matched only
   * against short standalone labels and accessible names, never against post
   * prose, so a post that merely discusses advertising is not caught.
   */
  const SPONSORED_WORD =
    /sponsor|gesponsor|patrocin|sponsoris|commandit|publicidad|werbeanzeige|anzeige|reklam|sponsrad|sponsoreret|sponset|sponsorizzat/i;

  /** Accessible names for the post menu on an ad: "… sponsored content". */
  const SPONSORED_ARIA =
    /sponsored content|gesponsorde inhoud|gesponserte inhalte|contenu sponsoris|contenido patrocinado|contenuto sponsorizzat|sponsrat innehåll/i;

  const MARKER_PATTERNS = {
    suggested: /suggested for you|people you may know|suggested group|suggested post|you might like|voorgesteld voor jou|vorgeschlagen/i,
    attribution: /commented on this|replied to a comment|reacted to this|shared a post|follows this|is following|reageerde hierop/i,
    reels: /\breels?\b|short videos/i,
  };

  /** Header text, with invisible padding removed. Read in memory, never stored. */
  function headerText(article) {
    const region = headerRegion(article);
    return normalize(region.textContent || '').slice(0, 400);
  }

  /**
   * Visit each element's *own* text — the text it holds directly rather than
   * through descendants — so a short standalone label can be recognised
   * without matching the whole post body.
   */
  function eachOwnText(article, visit) {
    for (const el of article.querySelectorAll('span, a, div, b, strong, i, em')) {
      if (el.hasAttribute('data-fbf-ui')) continue; // our own injected controls
      let own = '';
      for (const node of el.childNodes) {
        if (node.nodeType === 3) own += node.nodeValue;
      }
      own = normalize(own).trim();
      if (!own || own.length > 28) continue;
      if (visit(own, el) === false) return;
    }
  }

  /**
   * Is this an ad, and how do we know?
   *
   * Three signals in descending order of reliability:
   *
   *  1. The post menu's accessible name — "Open menu for <advertiser>
   *     sponsored content". Facebook has to expose this for screen readers,
   *     which makes it much harder to obfuscate than anything visible.
   *  2. The visible label, searched across the whole post rather than just
   *     the header, with invisible characters stripped first. The real label
   *     was found to be "Sponsored​" and to sit outside the header.
   *  3. The ad menu's own links, which only exist on ads.
   */
  function detectSponsored(article) {
    for (const el of article.querySelectorAll('[aria-label]')) {
      const label = normalize(el.getAttribute('aria-label'));
      if (SPONSORED_ARIA.test(label)) return 'aria-label';
    }

    let found = null;
    eachOwnText(article, (own) => {
      if (SPONSORED_WORD.test(own)) {
        found = 'label';
        return false;
      }
      return true;
    });
    if (found) return found;

    if (article.querySelector('a[href*="/ads/about"], a[href*="/ads/preferences"]')) {
      return 'ads-link';
    }
    return null;
  }

  function detectMarkers(article) {
    const text = headerText(article);

    const sponsoredVia = detectSponsored(article);
    const markers = {
      sponsored: Boolean(sponsoredVia),
      sponsoredVia,
      suggested: MARKER_PATTERNS.suggested.test(text),
      attribution: MARKER_PATTERNS.attribution.test(text),
      reels: false,
      followButton: false,
      joinButton: false,
    };

    // "Suggested for you" is a standalone label too, and sits outside the
    // header on the same posts where the sponsored label does.
    if (!markers.suggested) {
      eachOwnText(article, (own) => {
        if (MARKER_PATTERNS.suggested.test(own)) {
          markers.suggested = true;
          return false;
        }
        return true;
      });
    }

    if (article.querySelector('a[href*="/reel/"]') || MARKER_PATTERNS.reels.test(text)) {
      markers.reels = true;
    }

    const connect = detectConnectButtons(article);
    markers.followButton = connect.follow;
    markers.joinButton = connect.join;

    return markers;
  }

  /**
   * "Follow" and "Join", in the languages Facebook's UI ships in.
   *
   * Matched against whole labels only, so a post whose text happens to say
   * "follow" is not caught.
   */
  /**
   * "Follow" and "Join" are kept apart, because they prove different things.
   *
   * Follow says you do not follow this page. Join says you are not a member of
   * this group — and only Join says that. A group you *are* in can still show
   * a Follow control for its posts, so treating the two as one signal makes a
   * group you belong to look unchosen whenever the index has not got it.
   */
  const FOLLOW_WORD =
    /^(follow|volgen|folgen|suivre|seguir|segui|följ|følg|seuraa|obserwuj)$/i;

  const JOIN_WORD =
    /^(join|join group|lid worden|word lid|beitreten|rejoindre|unirse|entrar|gå med|bli med|dołącz)$/i;

  /**
   * A Follow or Join button on a post is direct evidence that you are *not*
   * connected to whoever posted it — Facebook does not offer to follow someone
   * you are already following, or to join a group you are already in.
   *
   * That matters more than it first appears. It proves a post is unchosen
   * without needing to read the author at all, which is what makes such posts
   * safe to hide even when the author link cannot be parsed. Detected and then
   * ignored, as it was at first, it is just a wasted signal.
   *
   * Buttons inside a nested article are skipped: those belong to a comment or
   * an embedded post, not to this post's own header.
   */
  function detectConnectButtons(article) {
    const found = { follow: false, join: false };

    for (const el of article.querySelectorAll('[role="button"], [aria-label], a[role="link"]')) {
      if (el.hasAttribute('data-fbf-ui')) continue; // our own injected controls
      const parentArticle = el.parentElement && el.parentElement.closest(ARTICLE);
      if (parentArticle && parentArticle !== article && article.contains(parentArticle)) continue;

      const label = normalize(el.getAttribute('aria-label') || el.textContent || '')
        .replace(/[·•|]/g, '')
        .trim();
      if (!label || label.length > 14) continue;

      if (FOLLOW_WORD.test(label)) found.follow = true;
      else if (JOIN_WORD.test(label)) found.join = true;

      if (found.follow && found.join) break;
    }
    return found;
  }

  /** Kept for callers that only care whether a post offers any connection. */
  function detectFollowButton(article) {
    const found = detectConnectButtons(article);
    return found.follow || found.join;
  }

  // ---------------------------------------------------------------------------
  // Index capture — the user's own friends and groups pages
  // ---------------------------------------------------------------------------

  /**
   * Name + key pairs for every profile link rendered in the page's main area.
   *
   * Restricted to role="main" so the left navigation, the contacts sidebar and
   * the chat rail cannot leak non-friends into the index. Whatever the user
   * has scrolled into view is what we see — there is no auto-scrolling here.
   */
  /**
   * Where to read the list from: inside role="main" when that works, the whole
   * page when it does not.
   *
   * Preferring role="main" keeps the left navigation and the chat rail out of
   * the index, which is why it is tried first. But on /friends/list Facebook
   * renders a role="main" element that contains no links at all — the friend
   * rows live outside it — so trusting the role unconditionally reads an empty
   * container and reports finding nothing on a page full of friends.
   *
   * Note the test is *did we find anything*, not *does the element exist*. An
   * earlier version fell back only when role="main" was missing, which is a
   * different and much rarer failure than the one that actually happens.
   *
   * All role="main" elements are searched, not just the first: Facebook
   * sometimes renders more than one, and querySelector would pick whichever
   * came first rather than whichever holds the content.
   *
   * Falling back to the whole document is imprecise rather than wrong here.
   * Capture only runs on /friends/list and /groups/joins, and on those two
   * pages the surrounding chrome holds your own contacts and your own groups
   * anyway.
   */
  function collectScoped(keyFn) {
    const merged = new Map();

    for (const main of document.querySelectorAll(MAIN)) {
      for (const [key, name] of collectKeys(main, keyFn)) {
        const existing = merged.get(key);
        if (existing === undefined || (!existing && name)) merged.set(key, name);
      }
    }

    if (merged.size) return merged;
    return collectKeys(document, keyFn);
  }

  /**
   * Collect every distinct key under `root`, with the best name we can find.
   *
   * Three things here are deliberate, each one a bug that produced exactly the
   * same symptom — an empty list — with no way to tell them apart:
   *
   *  - **A missing name does not disqualify a link.** The first version
   *    skipped any anchor with no text, assuming a named anchor for the same
   *    person appeared elsewhere. When Facebook renders the avatar inside the
   *    anchor and the name in a sibling outside it, that assumption drops
   *    every friend on the page. The key is what matters; the name is only for
   *    display, so keys are taken unconditionally and names fill in later.
   *
   *  - **One bad href cannot kill the pass.** Key parsing is per-anchor
   *    guarded. A single malformed URL used to throw straight out of the loop
   *    and abandon the whole page.
   *
   *  - **Names never overwrite a name with a blank.** Whichever anchor carries
   *    text wins, whatever order the anchors appear in.
   */
  function collectKeys(root, keyFn) {
    const found = new Map();
    if (!root) return found;

    let anchors;
    try {
      anchors = root.querySelectorAll('a[href]');
    } catch {
      return found;
    }

    for (const a of anchors) {
      let key = null;
      try {
        key = keyFn(a.getAttribute('href'));
      } catch {
        key = null;
      }
      if (!key) continue;

      const name = (a.textContent || '').trim().slice(0, 120);
      const existing = found.get(key);
      if (existing === undefined || (!existing && name)) found.set(key, name);
    }
    return found;
  }

  function toEntries(map) {
    return Array.from(map, ([key, name]) => ({ key, name }));
  }

  function captureProfiles() {
    return toEntries(collectScoped(K.profileKey));
  }

  function captureGroups() {
    return toEntries(collectScoped(K.groupKey));
  }

  /**
   * What the page actually looks like to us, for when capture comes back empty.
   *
   * An empty result has several possible causes that are indistinguishable
   * from the outside — no links at all, links we cannot parse, or links
   * outside the region we searched. This reports enough to tell them apart in
   * one look, rather than by another round of guessing.
   */
  function captureDiagnostics() {
    const main = document.querySelector(MAIN);
    const count = (root, selector) => {
      try {
        return root ? root.querySelectorAll(selector).length : 0;
      } catch {
        return -1;
      }
    };

    return {
      hasMain: Boolean(main),
      anchorsInDoc: count(document, 'a[href]'),
      anchorsInMain: count(main, 'a[href]'),
      roleLinks: count(document, '[role="link"]'),
      profilesInDoc: collectKeys(document, K.profileKey).size,
      profilesInMain: collectKeys(main, K.profileKey).size,
      groupsInDoc: collectKeys(document, K.groupKey).size,
      selectorsVersion: SELECTORS_VERSION,
    };
  }

  /**
   * What the feed looks like to us, for when classification fails wholesale.
   *
   * The equivalent of captureDiagnostics for the counting half. "Everything is
   * unreadable" has several distinct causes — no posts found at all, posts
   * found but no headings inside them, headings with no profile links — and
   * they need entirely different fixes. Reports enough to tell them apart.
   */
  function feedDiagnostics() {
    let articles = [];
    try {
      articles = findArticles(document);
    } catch {
      articles = [];
    }

    const strategies = {};
    let withAuthor = 0;
    let withGroup = 0;
    let withStory = 0;
    let withHeading = 0;

    for (const article of articles) {
      try {
        if (article.querySelector('h2, h3, h4')) withHeading++;
        const author = findAuthor(article);
        if (author) {
          withAuthor++;
          strategies[author.strategy] = (strategies[author.strategy] || 0) + 1;
        }
        if (findGroup(article)) withGroup++;
        if (findStory(article)) withStory++;
      } catch {
        /* one bad post must not stop the survey */
      }
    }

    const first = articles[0];
    const count = (root, selector) => {
      try {
        return root ? root.querySelectorAll(selector).length : 0;
      } catch {
        return -1;
      }
    };

    const roleArticles = count(document, ARTICLE);
    const usableRoleArticles = Array.from(document.querySelectorAll(ARTICLE)).filter(
      (el) => el.querySelector('a[href]'),
    ).length;

    return {
      hasFeedRole: Boolean(document.querySelector(FEED)),
      postSource: usableRoleArticles > 0 ? 'role=article' : 'structure',
      articlesTopLevel: articles.length,
      articlesIncludingNested: roleArticles,
      usableRoleArticles,
      withHeading,
      withAuthor,
      withGroup,
      withStory,
      strategies,
      firstArticleAnchors: count(first, 'a[href]'),
      firstArticleRoleLinks: count(first, '[role="link"]'),
      selectorsVersion: SELECTORS_VERSION,
    };
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * Counting is confined to the home feed so the headline number means
   * something specific: the share of *the home feed* that you chose. Posts on
   * a profile or inside a group are already content you navigated to.
   */
  function isHomeFeed(loc) {
    const l = loc || window.location;
    const path = l.pathname;
    if (path === '/' || path === '/home.php') return true;
    return false;
  }

  /**
   * Only "All friends" (/friends/list) — deliberately not /friends.
   *
   * The /friends landing page mixes in friend requests and "People you may
   * know" suggestions. Capturing there would put strangers into the allowlist,
   * and since the allowlist decides what counts as a friend post, that would
   * inflate the exact number this phase exists to measure. /friends/list is
   * the page that shows your friends and nothing else.
   */
  function isFriendsList(loc) {
    const l = loc || window.location;
    return /^\/friends\/list\/?$/.test(l.pathname);
  }

  /**
   * Only "Your groups" (/groups/joins) — deliberately not /groups/feed, whose
   * main column carries group posts and suggested groups rather than a clean
   * list of memberships.
   */
  function isGroupsList(loc) {
    const l = loc || window.location;
    return /^\/groups\/joins\/?$/.test(l.pathname);
  }

  FBF.selectors = {
    SELECTORS_VERSION,
    findArticles,
    findFeedContainer,
    headerRegion,
    findAuthor,
    findGroup,
    findStory,
    detectMarkers,
    headerText,
    captureProfiles,
    captureGroups,
    captureDiagnostics,
    feedDiagnostics,
    isHomeFeed,
    isFriendsList,
    isGroupsList,
  };
})(globalThis.FBF);
