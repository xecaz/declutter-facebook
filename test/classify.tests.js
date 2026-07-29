/**
 * The classification decision table.
 *
 * DOM reading is stubbed out here on purpose — this exercises the priority
 * order between markers, group context and the allowlist, which is where a
 * mistake would quietly bias the headline percentage.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const classify = globalThis.FBF.classify;

  const FRIEND_INDEX = { friends: { 'user:jane.doe': { name: 'Jane' } }, groups: {} };
  const GROUP_INDEX = { friends: {}, groups: { 'group:456': { name: 'Cyclists' } } };

  function run(spec, index) {
    globalThis.givenPost(spec);
    return classify.classify({}, { friends: {}, groups: {}, ...index });
  }

  test('a post by an indexed friend counts as a friend post', () => {
    const r = run({ authorKey: 'user:jane.doe' }, FRIEND_INDEX);
    assert.equal(r.type, 'friend');
    assert.equal(r.confident, true);
  });

  test('a post by someone not in the index is not a friend post', () => {
    const r = run({ authorKey: 'user:some.page' }, FRIEND_INDEX);
    assert.equal(r.type, 'page');
  });

  test('a post with no readable author is unknown, not algorithmic', () => {
    const r = run({}, FRIEND_INDEX);
    assert.equal(r.type, 'unknown');
  });

  test('group context wins over authorship for joined groups', () => {
    const r = run({ authorKey: 'user:a.stranger', groupKey: 'group:456' }, GROUP_INDEX);
    assert.equal(r.type, 'groupJoined');
  });

  test('a group you did not join is not counted as yours', () => {
    const r = run({ authorKey: 'user:a.stranger', groupKey: 'group:999' }, GROUP_INDEX);
    assert.equal(r.type, 'groupUnjoined');
  });

  test('a friend posting in a group you are not in is still a friend post', () => {
    // The case that dimmed someone's mother. Group context beats authorship
    // one way only: a stranger in a group you joined is yours, but a friend
    // stays yours wherever they post.
    const index = { friends: { 'user:jane.doe': { name: 'Jane' } }, groups: {} };
    const r = run({ authorKey: 'user:jane.doe', groupKey: 'group:999' }, index);
    assert.equal(r.type, 'friend');
  });

  test('a friend in an unjoined group is never acted on by the filter', () => {
    const index = { friends: { 'user:jane.doe': { name: 'Jane' } }, groups: {} };
    const r = run({ authorKey: 'user:jane.doe', groupKey: 'group:999' }, index);
    assert.equal(globalThis.FBF.filter.shouldAct(r), false, 'must never be hidden or dimmed');
  });

  test('a stranger in a group you joined is still counted as yours', () => {
    // The direction that was right, kept honest while fixing the other.
    const r = run({ authorKey: 'user:a.stranger', groupKey: 'group:456' }, GROUP_INDEX);
    assert.equal(r.type, 'groupJoined');
  });

  test('sponsored beats everything, so ads cannot flatter the number', () => {
    const r = run({ authorKey: 'user:jane.doe', markers: { sponsored: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'sponsored');
  });

  test('the allowlist beats a "suggested" label', () => {
    const r = run({ authorKey: 'user:jane.doe', markers: { suggested: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'friend');
  });

  test('a suggested post with an unindexed author is suggested', () => {
    const r = run({ authorKey: 'user:nobody', markers: { suggested: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'suggested');
  });

  test('disagreements between index and label are flagged', () => {
    const agree = run({ authorKey: 'user:jane.doe' }, FRIEND_INDEX);
    assert.equal(agree.disagreement, false);

    const suggested = run(
      { authorKey: 'user:jane.doe', markers: { suggested: true } },
      FRIEND_INDEX,
    );
    assert.equal(suggested.disagreement, true);

    // "X commented on this" on a post we credited to a friend means the author
    // link was probably misread.
    const attributed = run(
      { authorKey: 'user:jane.doe', markers: { attribution: true } },
      FRIEND_INDEX,
    );
    assert.equal(attributed.disagreement, true);
  });

  test('a Follow button settles a post whose author cannot be read', () => {
    // Without this it falls through to 'unknown', which is never hidden — so
    // obviously-unchosen page posts stayed on screen indefinitely.
    const r = run({ markers: { followButton: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'page');
    assert.equal(r.proven, true);
  });

  test('a friend post with a Follow button is still a friend post', () => {
    const r = run({ authorKey: 'user:jane.doe', markers: { followButton: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'friend');
    assert.equal(r.proven, false, 'proof must never apply to something you chose');
  });

  test('a post we did not credit to you is never a disagreement', () => {
    const r = run({ authorKey: 'user:nobody', markers: { attribution: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'page');
    assert.equal(r.disagreement, false);
  });

  test('a loose author match is reported as low confidence', () => {
    const r = run(
      { authorKey: 'user:jane.doe', strategy: 'article-scan', confident: false },
      FRIEND_INDEX,
    );
    assert.equal(r.type, 'friend');
    assert.equal(r.confident, false);
  });

  test('diagnostics carry structure only — no keys, names or text', () => {
    const result = run({ authorKey: 'user:jane.doe', groupKey: 'group:456' }, FRIEND_INDEX);
    const diag = classify.diagnose(result);

    const serialized = JSON.stringify(diag);
    assert.ok(!serialized.includes('jane.doe'), 'author key must not be logged');
    assert.ok(!serialized.includes('group:456'), 'group key must not be logged');
    assert.equal(diag.hadAuthor, true);
    assert.equal(diag.hadGroup, true);
  });

  test('an unindexed group with no Join button is treated as uncertain', () => {
    // A group joined since the last capture looks exactly like a group you
    // were never in. Without a Join button there is no evidence either way.
    const r = run({ authorKey: 'user:someone', groupKey: 'group:999' }, GROUP_INDEX);
    assert.equal(r.type, 'groupUnjoined');
    assert.equal(r.uncertainMembership, true);
    assert.equal(r.proven, false);
    assert.equal(globalThis.FBF.filter.shouldAct(r), false, 'must not be dimmed or hidden');
  });

  test('a Join button settles an unindexed group', () => {
    const r = run(
      { authorKey: 'user:someone', groupKey: 'group:999', markers: { joinButton: true } },
      GROUP_INDEX,
    );
    assert.equal(r.type, 'groupUnjoined');
    assert.equal(r.uncertainMembership, false);
    assert.equal(r.proven, true);
    assert.equal(globalThis.FBF.filter.shouldAct(r), true);
  });

  test('a Follow button does not convict a group', () => {
    // A group you belong to can still offer to follow its posts, so Follow
    // must not stand in for Join here.
    const r = run(
      { authorKey: 'user:someone', groupKey: 'group:999', markers: { followButton: true } },
      GROUP_INDEX,
    );
    assert.equal(r.proven, false, 'only Join proves non-membership');
    assert.equal(globalThis.FBF.filter.shouldAct(r), false);
  });

  test('a Follow button still convicts a page', () => {
    const r = run({ authorKey: 'user:some.page', markers: { followButton: true } }, FRIEND_INDEX);
    assert.equal(r.type, 'page');
    assert.equal(r.proven, true);
    assert.equal(globalThis.FBF.filter.shouldAct(r), true);
  });

  test('a group in your index is never uncertain', () => {
    const r = run({ authorKey: 'user:someone', groupKey: 'group:456' }, GROUP_INDEX);
    assert.equal(r.type, 'groupJoined');
    assert.equal(r.uncertainMembership, false);
  });
})();
