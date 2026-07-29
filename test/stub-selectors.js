/**
 * Stands in for selectors.js so the decision table can be tested without a
 * Facebook page.
 *
 * classify.js captures `FBF.selectors` once, when it loads, so this object's
 * identity has to stay fixed. Its methods read from a mutable holder that each
 * test rewrites — that is what lets the stub change between tests without
 * re-evaluating classify.js, which Manifest V3's content security policy would
 * block anyway.
 *
 * Loaded only by test/index.html. It is not in the manifest and never reaches
 * a real page.
 */
globalThis.FBF = globalThis.FBF || {};

globalThis.STUB = {
  markers: {},
  author: null,
  group: null,
  story: null,
};

/** Set a post up for classification, then call FBF.classify.classify({}, index). */
globalThis.givenPost = function givenPost(spec) {
  globalThis.STUB = {
    markers: spec.markers || {},
    author: spec.authorKey
      ? {
          key: spec.authorKey,
          strategy: spec.strategy || 'heading',
          confident: spec.confident !== false,
        }
      : null,
    group: spec.groupKey ? { key: spec.groupKey, strategy: 'header-region' } : null,
    story: spec.storyKey || null,
  };
};

const NO_MARKERS = {
  sponsored: false,
  suggested: false,
  attribution: false,
  reels: false,
  followButton: false,
};

globalThis.FBF.selectors = {
  SELECTORS_VERSION: 'test',
  detectMarkers: () => ({ ...NO_MARKERS, ...globalThis.STUB.markers }),
  findAuthor: () => globalThis.STUB.author,
  findGroup: () => globalThis.STUB.group,
  findStory: () => globalThis.STUB.story,
};
