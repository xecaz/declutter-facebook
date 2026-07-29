/**
 * URL -> stable key normalization.
 *
 * Facebook decorates essentially every href with per-impression tracking
 * params (__cft__[0], __tn__, comment_id, ...). Two links to the same person
 * in two different posts will not be string-equal, so every href has to be
 * reduced to a stable key before it can be compared against the index.
 *
 * Key shapes:
 *   id:100012345678   numeric profile id  (/profile.php?id=, /people/Name/<id>)
 *   user:jane.doe     vanity username     (/jane.doe)
 *   group:456789      group id            (/groups/456789)
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const ORIGIN = 'https://www.facebook.com';

  /**
   * First path segments that are Facebook surfaces, not usernames. A bare
   * /watch or /marketplace must never be mistaken for a profile.
   */
  const RESERVED = new Set([
    'ads', 'bookmarks', 'browse', 'business', 'buylocal', 'careers', 'checkpoint',
    'community', 'dialog', 'directory', 'discover', 'donate', 'events', 'explore',
    'friends', 'fundraisers', 'gaming', 'games', 'groups', 'help', 'home.php',
    'hashtag', 'jobs', 'l.php', 'legal', 'live', 'login', 'login.php', 'logout.php',
    'marketplace', 'media', 'memories', 'messages', 'notes', 'notifications',
    'pages', 'pay', 'people', 'permalink.php', 'photo', 'photo.php', 'photos',
    'places', 'plugins', 'policies', 'policy.php', 'privacy', 'profile.php',
    'reel', 'reels', 'saved', 'search', 'settings', 'share', 'sharer',
    'sharer.php', 'stories', 'story.php', 'support', 'terms', 'video', 'videos',
    'watch', 'weather', 'zero',
  ]);

  /** Params that carry no identity, only impression tracking. */
  const TRACKING_PARAMS = [
    '__cft__', '__tn__', '__eep__', '__xts__', '__md__',
    'comment_id', 'reply_comment_id', 'notif_id', 'notif_t',
    'ref', 'refid', 'refsrc', 'hc_ref', 'hc_location', 'fref', 'rdid',
    'share_url', 'mibextid', 'source', 'sfnsn', 'extid', 'paipv', 'eav',
    'av', 'rc', 'checkpoint_src', '_rdr', '_rdc',
  ];

  /**
   * decodeURIComponent throws a URIError on a stray '%', which a real
   * Facebook page will hand us sooner or later. Every caller here is trying to
   * read a key, not validate encoding, so a failed decode falls back to the
   * raw text rather than taking down whatever loop is running.
   */
  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function toUrl(href) {
    if (!href || typeof href !== 'string') return null;
    if (href.startsWith('#') || href.startsWith('javascript:')) return null;
    try {
      return new URL(href, ORIGIN);
    } catch {
      return null;
    }
  }

  /** Strip tracking params so the same target always yields the same string. */
  function cleanUrl(href) {
    const url = toUrl(href);
    if (!url) return null;
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    // __cft__[0] and friends are indexed; delete by prefix as well.
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.startsWith('__') || key.startsWith('_ft_')) url.searchParams.delete(key);
    }
    return url;
  }

  function segments(url) {
    return url.pathname.split('/').filter(Boolean);
  }

  /**
   * Reduce an href to a profile key, or null if it does not identify a person
   * or page. Works on author links, avatar links and permalinks alike.
   */
  function profileKey(href) {
    const url = cleanUrl(href);
    if (!url) return null;
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;

    const seg = segments(url);
    if (!seg.length) return null;

    // /profile.php?id=100012345678
    if (seg[0] === 'profile.php') {
      const id = url.searchParams.get('id');
      return id && /^\d+$/.test(id) ? `id:${id}` : null;
    }

    // /people/Jane-Doe/100012345678/
    if (seg[0] === 'people') {
      const id = seg.find((s) => /^\d{6,}$/.test(s));
      return id ? `id:${id}` : null;
    }

    // /pg/SomePage/... — legacy page prefix
    if (seg[0] === 'pg' && seg[1]) {
      return normalizeVanity(seg[1]);
    }

    if (RESERVED.has(seg[0])) return null;

    // /jane.doe, /jane.doe/posts/123, /jane.doe/?locale=…
    return normalizeVanity(seg[0]);
  }

  function normalizeVanity(raw) {
    const name = decode(raw).trim().toLowerCase();
    if (!name) return null;
    // Vanity names are letters/digits/period/dash; anything else is a surface.
    if (!/^[a-z0-9.\-_]+$/.test(name)) return null;
    if (name.endsWith('.php')) return null;
    if (RESERVED.has(name)) return null;
    if (/^\d{6,}$/.test(name)) return `id:${name}`;
    return `user:${name}`;
  }

  /** Reduce an href to a group key, or null. */
  function groupKey(href) {
    const url = cleanUrl(href);
    if (!url) return null;
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    const seg = segments(url);
    if (seg[0] !== 'groups' || !seg[1]) return null;
    const id = decode(seg[1]).toLowerCase();
    // Skip the group *surfaces* (/groups/feed, /groups/joins, /groups/discover).
    if (['feed', 'joins', 'discover', 'create', 'search', 'invites'].includes(id)) return null;
    if (!/^[a-z0-9.\-_]+$/.test(id)) return null;
    return `group:${id}`;
  }

  /**
   * Extract a story identifier from a permalink, used to recognise the same
   * post arriving again after Facebook recycles the feed DOM.
   */
  function storyKey(href) {
    const url = cleanUrl(href);
    if (!url) return null;

    const fbid = url.searchParams.get('story_fbid') || url.searchParams.get('fbid');
    if (fbid && /^\d+$/.test(fbid)) return `story:${fbid}`;

    const seg = segments(url);
    for (let i = 0; i < seg.length - 1; i++) {
      if (['posts', 'permalink', 'videos', 'photos', 'reel'].includes(seg[i])) {
        const id = seg[i + 1];
        if (/^\d{6,}$/.test(id)) return `story:${id}`;
        // pfbid-style opaque post ids
        if (/^pfbid[a-z0-9]+$/i.test(id)) return `story:${id.toLowerCase()}`;
      }
    }
    return null;
  }

  /**
   * djb2 over a string. Used only for in-memory dedup of posts that expose no
   * permalink — the source text is hashed and discarded, never stored.
   */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return `h:${(h >>> 0).toString(36)}`;
  }

  FBF.keys = { profileKey, groupKey, storyKey, cleanUrl, hash, RESERVED };
})(globalThis.FBF);
