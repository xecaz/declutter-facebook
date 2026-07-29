/**
 * What gets hidden, and — more importantly — what never does.
 *
 * Hiding is not symmetric with showing. An ad left on screen costs a moment's
 * irritation; a friend's post hidden by mistake is one you never learn existed.
 * So the rule is that uncertainty always resolves towards leaving the post
 * alone, and these tests exist to stop that rule being quietly relaxed.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const filter = globalThis.FBF.filter;

  function result(type, extra) {
    return { type, confident: true, ...extra };
  }

  test('posts you chose are never touched', () => {
    assert.equal(filter.shouldAct(result('friend')), false);
    assert.equal(filter.shouldAct(result('groupJoined')), false);
  });

  test('unreadable posts are never hidden', () => {
    // We could not read it, so we cannot judge it — and a post we cannot judge
    // might be from a friend.
    assert.equal(filter.shouldAct(result('unknown')), false);
    assert.equal(filter.shouldAct(result('unknown', { confident: false })), false);
  });

  test('absence from the index is not enough on its own', () => {
    // The index knows friends and joined groups. It has no record of the pages
    // you follow, and it goes stale for groups. So "not in the index" was
    // convicting pages the user follows — which show no Follow button
    // precisely because they are already followed.
    assert.equal(filter.shouldAct(result('page')), false);
    assert.equal(filter.shouldAct(result('groupUnjoined')), false);
  });

  test('a Follow button is enough', () => {
    assert.equal(filter.shouldAct(result('page', { proven: true })), true);
    assert.equal(filter.shouldAct(result('page', { proven: true, confident: false })), true);
  });

  test('a Join button is enough for a group', () => {
    assert.equal(filter.shouldAct(result('groupUnjoined', { proven: true })), true);
  });

  test('a suggested label is enough', () => {
    assert.equal(filter.shouldAct(result('suggested', { proven: true })), true);
  });

  test('unreadable posts can be opted in to, and default to protected', () => {
    filter.setHideUnreadable(true);
    try {
      assert.equal(filter.shouldAct(result('unknown', { confident: false })), true);
    } finally {
      filter.setHideUnreadable(false);
    }
    assert.equal(filter.shouldAct(result('unknown', { confident: false })), false);
  });

  test('opting in to unreadable posts still never touches friends', () => {
    filter.setHideUnreadable(true);
    try {
      assert.equal(filter.shouldAct(result('friend', { confident: false })), false);
      assert.equal(filter.shouldAct(result('groupJoined', { confident: false })), false);
    } finally {
      filter.setHideUnreadable(false);
    }
  });

  test('unchosen posts with evidence are acted on', () => {
    assert.equal(filter.shouldAct(result('page', { proven: true })), true);
    assert.equal(filter.shouldAct(result('suggested', { proven: true })), true);
    assert.equal(filter.shouldAct(result('groupUnjoined', { proven: true })), true);
  });

  test('a Follow button is proof enough to act without a readable author', () => {
    // This is the case that left page and group posts on screen: the author
    // link could not be parsed, so confidence was false and nothing happened,
    // even though a Follow button proves the post is unchosen.
    assert.equal(filter.shouldAct(result('page', { confident: false, proven: true })), true);
    assert.equal(
      filter.shouldAct(result('groupUnjoined', { confident: false, proven: true })),
      true,
    );
  });

  test('proof never overrides a post you chose', () => {
    assert.equal(filter.shouldAct(result('friend', { proven: true })), false);
    assert.equal(filter.shouldAct(result('groupJoined', { proven: true })), false);
  });

  test('ads are acted on even without a readable author', () => {
    // A sponsored marker is proof in itself; ads have no author link at all,
    // so requiring author confidence would exempt every ad.
    assert.equal(filter.shouldAct(result('sponsored', { confident: false, proven: true })), true);
  });

  test('hide mode removes the post and restores it cleanly', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      filter.setMode('hide');
      filter.apply(el, result('page', { proven: true }));
      assert.equal(el.style.display, 'none');

      filter.setMode('off');
      filter.apply(el, result('page', { proven: true }));
      assert.equal(el.style.display, '', 'the page must be left as we found it');
    } finally {
      el.remove();
      filter.setMode('off');
    }
  });

  test('dim mode is visual only and leaves the post in place', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      filter.setMode('dim');
      filter.apply(el, result('sponsored', { proven: true }));
      assert.equal(el.style.display, '', 'dimming must not remove the post');
      assert.ok(el.style.opacity, 'should be dimmed');
    } finally {
      el.remove();
      filter.setMode('off');
    }
  });

  test('switching modes does not leave a post both hidden and dimmed', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      filter.setMode('hide');
      filter.apply(el, result('page', { proven: true }));
      filter.setMode('dim');
      filter.apply(el, result('page', { proven: true }));

      assert.equal(el.style.display, '', 'must not still be hidden');
      assert.ok(el.style.opacity, 'should now be dimmed');
    } finally {
      el.remove();
      filter.setMode('off');
    }
  });

  test('an unknown post stays visible in every mode', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      for (const mode of ['dim', 'hide']) {
        filter.setMode(mode);
        filter.apply(el, result('unknown', { confident: false }));
        assert.equal(el.style.display, '', `${mode}: must not hide`);
        assert.equal(el.style.opacity, '', `${mode}: must not dim`);
      }
    } finally {
      el.remove();
      filter.setMode('off');
    }
  });
})();
