/**
 * Capture against fixtures modelled on Facebook's real markup.
 *
 * The first shape here is not invented. It is the structure of an actual
 * /friends/list page: two role="main" elements that are completely empty, and
 * the friend rows rendered inside role="navigation" instead. Scoping capture
 * to role="main" therefore read an empty container and reported finding
 * nothing on a page holding 259 friends.
 *
 * Names and URLs are synthetic — only the structure is copied.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const S = globalThis.FBF.selectors;

  /**
   * Mount a fixture in the live document, since capture reads from `document`
   * by design, and always take it back down.
   */
  function withFixture(html, fn) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      return fn();
    } finally {
      host.remove();
    }
  }

  /** One friend row: an avatar anchor with no text, then the named anchor. */
  function row(href, name) {
    return (
      `<div><a role="link" href="${href}"><i></i></a>` +
      `<span><a role="link" href="${href}">${name}</a></span></div>`
    );
  }

  const REAL_SHAPE =
    '<div role="main"><div><span></span></div></div>' +
    '<div role="main"><div></div></div>' +
    '<div role="navigation">' +
    row('/jane.doe', 'Jane Doe') +
    row('/profile.php?id=100011112222', 'Someone Else') +
    row('/another.person', 'Another Person') +
    '</div>';

  test('captures friends when role="main" is empty and the list sits elsewhere', () => {
    withFixture(REAL_SHAPE, () => {
      const found = S.captureProfiles();
      const keys = found.map((f) => f.key).sort();
      assert.equal(found.length, 3, 'should find all three rows');
      assert.equal(keys.join(','), 'id:100011112222,user:another.person,user:jane.doe');
    });
  });

  test('names come from the named anchor, not the empty avatar anchor', () => {
    withFixture(REAL_SHAPE, () => {
      const byKey = new Map(S.captureProfiles().map((f) => [f.key, f.name]));
      assert.equal(byKey.get('user:jane.doe'), 'Jane Doe');
      assert.equal(byKey.get('id:100011112222'), 'Someone Else');
    });
  });

  test('role="main" is still preferred when it actually holds the list', () => {
    // The fallback must not become the default: scoping to main is what keeps
    // the chat rail and site navigation out of the index.
    const scoped =
      '<div role="main">' + row('/in.main', 'In Main') + '</div>' +
      '<div role="navigation">' + row('/in.nav', 'In Nav') + '</div>';

    withFixture(scoped, () => {
      const keys = S.captureProfiles().map((f) => f.key);
      assert.equal(keys.join(','), 'user:in.main');
    });
  });

  test('every role="main" is searched, not just the first', () => {
    const twoMains =
      '<div role="main"></div>' +
      '<div role="main">' + row('/second.main', 'Second Main') + '</div>';

    withFixture(twoMains, () => {
      const keys = S.captureProfiles().map((f) => f.key);
      assert.equal(keys.join(','), 'user:second.main');
    });
  });

  test('one malformed href does not abandon the rest of the page', () => {
    const withBadLink =
      '<div role="navigation">' +
      '<a role="link" href="/100%">broken</a>' +
      row('/still.found', 'Still Found') +
      '</div>';

    withFixture(withBadLink, () => {
      const keys = S.captureProfiles().map((f) => f.key);
      assert.ok(keys.includes('user:still.found'), 'the good link must still be captured');
    });
  });

  test('group capture reads group links the same way', () => {
    const groups =
      '<div role="navigation">' +
      '<a role="link" href="/groups/456789">Cyclists</a>' +
      '<a role="link" href="/groups/some.slug/">Bakers</a>' +
      '<a role="link" href="/groups/joins">Your groups</a>' +
      '</div>';

    withFixture(groups, () => {
      const keys = S.captureGroups().map((g) => g.key).sort();
      assert.equal(keys.join(','), 'group:456789,group:some.slug', '/groups/joins is a surface');
    });
  });

  test('diagnostics describe the empty-main case accurately', () => {
    withFixture(REAL_SHAPE, () => {
      const d = S.captureDiagnostics();
      assert.equal(d.hasMain, true);
      assert.equal(d.anchorsInMain, 0, 'the mains are empty, as on the real page');
      assert.equal(d.profilesInMain, 0);
      assert.ok(d.profilesInDoc >= 3, 'but the profiles are visible on the page');
    });
  });

  /** A post: an author link, a permalink, some text. */
  function post(author, storyId) {
    return (
      '<div class="post">' +
      `<h3><a role="link" href="/${author}">Someone</a></h3>` +
      `<a role="link" href="/${author}/posts/${storyId}">2 h</a>` +
      '<div>body text</div>' +
      '</div>'
    );
  }

  test('empty role="article" placeholders are not counted as posts', () => {
    // Facebook ships these; counting them produced a feed that was 100%
    // "could not read" while real posts went unnoticed.
    withFixture('<div role="article"><div><span></span></div></div>', () => {
      assert.equal(S.findArticles(document).length, 0);
    });
  });

  test('posts are found structurally when role="article" is absent', () => {
    const listShaped =
      '<div role="list">' +
      '<div role="listitem">' + post('jane.doe', '111111111') + '</div>' +
      '<div role="listitem">' + post('john.roe', '222222222') + '</div>' +
      '</div>';

    withFixture(listShaped, () => {
      const found = S.findArticles(document);
      assert.equal(found.length, 2, 'both posts should be found without role="article"');
    });
  });

  test('role="article" is still preferred when it carries real posts', () => {
    const mixed = `<div role="article">${post('in.article', '333333333')}</div>`;
    withFixture(mixed, () => {
      const found = S.findArticles(document);
      assert.equal(found.length, 1);
      assert.equal(found[0].getAttribute('role'), 'article');
    });
  });

  test('comments nested inside a post are not counted as posts', () => {
    const withComment =
      '<div role="article">' +
      '<h3><a role="link" href="/jane.doe">Someone</a></h3>' +
      '<a role="link" href="/jane.doe/posts/444444444">2 h</a>' +
      '<div role="article"><a role="link" href="/john.roe">Commenter</a></div>' +
      '</div>';

    withFixture(withComment, () => {
      assert.equal(S.findArticles(document).length, 1);
    });
  });

  test('structural detection keeps posts separate rather than merging them', () => {
    const two =
      '<div>' + post('a.person', '555555555') + post('b.person', '666666666') + '</div>';
    withFixture(two, () => {
      const found = S.findArticles(document);
      assert.equal(found.length, 2, 'two posts must not collapse into one container');
    });
  });

  test('the observer target is never an element that may be empty', () => {
    // An observer attached to a container that never mutates never fires, and
    // reports no error while doing so. On /friends/list the role="main"
    // elements are empty, which silently limited capture to the first
    // screenful — so main must not be an observer target, only a read scope.
    withFixture('<div role="main"></div>', () => {
      const target = S.findFeedContainer();
      assert.equal(
        target.getAttribute && target.getAttribute('role'),
        null,
        'must not fall back to role="main"',
      );
      assert.equal(target, document.body);
    });
  });

  test('the observer target is the feed when there is one', () => {
    withFixture('<div role="feed"><div role="article"></div></div>', () => {
      const target = S.findFeedContainer();
      assert.equal(target.getAttribute('role'), 'feed');
    });
  });

  // Route matching, given a location rather than the real one.
  test('route matching accepts the pages we capture from', () => {
    assert.equal(S.isFriendsList({ pathname: '/friends/list' }), true);
    assert.equal(S.isFriendsList({ pathname: '/friends/list/' }), true);
    assert.equal(S.isGroupsList({ pathname: '/groups/joins' }), true);
    assert.equal(S.isHomeFeed({ pathname: '/' }), true);
    assert.equal(S.isHomeFeed({ pathname: '/home.php' }), true);
  });

  test('route matching rejects the pages that would pollute the index', () => {
    // /friends mixes in requests and "People you may know"; /groups/feed shows
    // suggested groups. Capturing on either would put strangers in the
    // allowlist and inflate the measurement.
    assert.equal(S.isFriendsList({ pathname: '/friends' }), false);
    assert.equal(S.isFriendsList({ pathname: '/friends/suggestions' }), false);
    assert.equal(S.isGroupsList({ pathname: '/groups/feed' }), false);
    assert.equal(S.isHomeFeed({ pathname: '/friends/list' }), false);
  });
})();
