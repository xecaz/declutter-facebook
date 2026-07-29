/**
 * Key normalization is the load-bearing pure logic in this extension: if two
 * links to the same person do not reduce to the same key, the allowlist misses
 * and real friends get counted as strangers.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const K = globalThis.FBF.keys;

  test('numeric profiles reduce to an id key', () => {
    assert.equal(K.profileKey('/profile.php?id=100012345678'), 'id:100012345678');
    assert.equal(
      K.profileKey('https://www.facebook.com/profile.php?id=100012345678&sk=about'),
      'id:100012345678',
    );
    assert.equal(K.profileKey('/people/Jane-Doe/100012345678/'), 'id:100012345678');
  });

  test('vanity profiles reduce to a user key', () => {
    assert.equal(K.profileKey('/jane.doe'), 'user:jane.doe');
    assert.equal(K.profileKey('/Jane.Doe/'), 'user:jane.doe');
    assert.equal(K.profileKey('https://www.facebook.com/jane.doe/posts/12345'), 'user:jane.doe');
    assert.equal(K.profileKey('/pg/SomePage/posts/'), 'user:somepage');
  });

  test('tracking params do not change the key', () => {
    const bare = K.profileKey('/jane.doe');
    const tracked = K.profileKey(
      '/jane.doe?__cft__[0]=AZXqO9&__tn__=-UC%2CP-R&comment_id=99&ref=notif',
    );
    assert.equal(tracked, bare);
    assert.equal(tracked, 'user:jane.doe');
  });

  test('Facebook surfaces are not mistaken for people', () => {
    for (const href of [
      '/watch',
      '/marketplace/item/123',
      '/groups/456',
      '/reel/789',
      '/photo.php?fbid=1',
      '/permalink.php?story_fbid=1&id=2',
      '/settings',
      '/friends/list',
      '/hashtag/cats',
    ]) {
      assert.equal(K.profileKey(href), null, `expected null for ${href}`);
    }
  });

  test('non-Facebook and unusable hrefs are rejected', () => {
    assert.equal(K.profileKey('https://example.com/jane.doe'), null);
    assert.equal(K.profileKey('#'), null);
    assert.equal(K.profileKey('javascript:void(0)'), null);
    assert.equal(K.profileKey(''), null);
    assert.equal(K.profileKey(null), null);
  });

  test('group links reduce to a group key', () => {
    assert.equal(K.groupKey('/groups/456789'), 'group:456789');
    assert.equal(K.groupKey('/groups/456789/permalink/111/'), 'group:456789');
    assert.equal(K.groupKey('/groups/some.group.slug/'), 'group:some.group.slug');
    assert.equal(
      K.groupKey('https://www.facebook.com/groups/456789?ref=bookmarks'),
      'group:456789',
    );
  });

  test('group surfaces are not mistaken for groups', () => {
    assert.equal(K.groupKey('/groups/feed'), null);
    assert.equal(K.groupKey('/groups/joins'), null);
    assert.equal(K.groupKey('/groups/discover/'), null);
    assert.equal(K.groupKey('/jane.doe'), null);
  });

  test('story keys identify a post across remounting', () => {
    assert.equal(K.storyKey('/jane.doe/posts/1234567890'), 'story:1234567890');
    assert.equal(K.storyKey('/permalink.php?story_fbid=987654321&id=1'), 'story:987654321');
    assert.equal(K.storyKey('/groups/456/permalink/778899/'), 'story:778899');
    assert.equal(K.storyKey('/jane.doe/posts/pfbid02AbCdEf?__cft__[0]=x'), 'story:pfbid02abcdef');
    assert.equal(K.storyKey('/jane.doe'), null);
  });

  test('the same post yields the same story key regardless of tracking params', () => {
    const a = K.storyKey('/jane.doe/posts/1234567890?__cft__[0]=AAA&__tn__=R');
    const b = K.storyKey('/jane.doe/posts/1234567890?__cft__[0]=BBB&comment_id=7');
    assert.equal(a, b);
  });

  test('malformed percent-encoding does not throw', () => {
    // decodeURIComponent throws a URIError on a stray '%'. Uncaught, that used
    // to escape the key lookup and abandon the whole page mid-scan, so one bad
    // link anywhere made the extension look completely dead.
    for (const href of ['/100%', '/a%zz', '/%E0%A4%A', '/groups/100%', '/%']) {
      let threw = null;
      try {
        K.profileKey(href);
        K.groupKey(href);
        K.storyKey(href);
      } catch (error) {
        threw = error;
      }
      assert.equal(threw, null, `${href} should not throw`);
    }
  });

  test('hash is stable and does not retain its input', () => {
    assert.equal(K.hash('same text'), K.hash('same text'));
    assert.notEqual(K.hash('one'), K.hash('two'));
    assert.match(K.hash('anything'), /^h:[a-z0-9]+$/);
  });
})();
