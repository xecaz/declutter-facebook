/**
 * The automatic sweep.
 *
 * This is the one part of the extension that writes to the account without
 * being asked each time, so the tests are about restraint rather than
 * capability: off unless switched on, one action per source, never a friend,
 * and it must stop itself when something looks wrong instead of clicking on
 * blindly.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const sweeper = globalThis.FBF.sweeper;

  function withPost(html, fn) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      return fn(host.firstElementChild, host);
    } finally {
      host.remove();
    }
  }

  const POST = '<div class="post"><div role="button" aria-haspopup="menu"></div></div>';

  // These tests are about queueing and identity, not about the evidence rule
  // — so posts arrive already carrying the proof filter.js requires.
  function result(type, extra) {
    return { type, confident: true, proven: true, ...extra };
  }

  test('the sweep is off unless switched on', () => {
    assert.equal(sweeper.isEnabled(), false, 'must never run by default');
    withPost(POST, (post) => {
      let opened = 0;
      post.querySelector('[aria-haspopup="menu"]').addEventListener('click', () => opened++);
      sweeper.consider(post, result('page'));
      assert.equal(opened, 0);
      assert.equal(sweeper.state().queued, 0, 'nothing may even be queued');
    });
  });

  test('friends and joined groups are never queued', () => {
    sweeper.setEnabled(true);
    try {
      for (const type of ['friend', 'groupJoined']) {
        withPost(POST, (post) => {
          const before = sweeper.state().queued;
          sweeper.consider(post, result(type));
          assert.equal(sweeper.state().queued, before, `${type} must never be swept`);
        });
      }
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('unreadable posts are not swept while they are protected', () => {
    globalThis.FBF.filter.setHideUnreadable(false);
    sweeper.setEnabled(true);
    try {
      withPost(POST, (post) => {
        const before = sweeper.state().queued;
        sweeper.consider(post, result('unknown', { confident: false }));
        assert.equal(sweeper.state().queued, before);
      });
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('one source is queued once, however many of its posts appear', () => {
    // Without this a page with forty posts in the feed would be actioned forty
    // times — the difference between a few dozen writes and thousands.
    sweeper.setEnabled(true);
    try {
      const before = sweeper.state().queued;
      for (let i = 0; i < 5; i++) {
        withPost(POST, (post) => {
          sweeper.consider(post, result('page', { authorKey: 'user:repeat.page' }));
        });
      }
      assert.equal(sweeper.state().queued - before, 1, 'five posts, one action');
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('distinct sources are queued separately', () => {
    sweeper.setEnabled(true);
    try {
      const before = sweeper.state().queued;
      withPost(POST, (p) => sweeper.consider(p, result('page', { authorKey: 'user:one' })));
      withPost(POST, (p) => sweeper.consider(p, result('page', { authorKey: 'user:two' })));
      assert.equal(sweeper.state().queued - before, 2);
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('a group is identified by its group key, not its author', () => {
    sweeper.setEnabled(true);
    try {
      const before = sweeper.state().queued;
      // Two different people posting in the same unjoined group.
      withPost(POST, (p) =>
        sweeper.consider(p, result('groupUnjoined', { authorKey: 'user:a', groupKey: 'group:9' })),
      );
      withPost(POST, (p) =>
        sweeper.consider(p, result('groupUnjoined', { authorKey: 'user:b', groupKey: 'group:9' })),
      );
      assert.equal(sweeper.state().queued - before, 1, 'one group, one action');
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('a post with no identifiable source is skipped rather than guessed at', () => {
    // "Unnamed source" is not an identity: treating it as one would collapse
    // unrelated pages together and action only the first of them.
    sweeper.setEnabled(true);
    try {
      const before = sweeper.state().queued;
      withPost(POST, (post) => sweeper.consider(post, result('page')));
      assert.equal(sweeper.state().queued, before);
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('switching the sweep off empties the queue', () => {
    sweeper.setEnabled(true);
    withPost(POST, (p) => sweeper.consider(p, result('page', { authorKey: 'user:drained' })));
    sweeper.setEnabled(false);
    assert.equal(sweeper.state().queued, 0);
  });

  test('ads are never swept', () => {
    // Facebook's menu on an ad offers "Hide ad", not "Hide all from", so every
    // ad was a guaranteed miss — and misses in a row are what stop the sweep.
    // Two ads in one feed were enough to cancel everything queued behind them.
    sweeper.setEnabled(true);
    try {
      const before = sweeper.state().queued;
      withPost(POST, (post) => {
        sweeper.consider(post, result('sponsored', { authorKey: 'user:advertiser' }));
      });
      assert.equal(sweeper.state().queued, before, 'an ad must not be queued');
    } finally {
      sweeper.setEnabled(false);
    }
  });

  test('the sweep targets recurring sources only', () => {
    assert.equal(sweeper.SWEEPABLE.has('page'), true);
    assert.equal(sweeper.SWEEPABLE.has('groupUnjoined'), true);
    assert.equal(sweeper.SWEEPABLE.has('suggested'), true);

    // Ads are an endless supply of one-off advertisers; hiding them one at a
    // time buys nothing, and they are dimmed locally anyway.
    assert.equal(sweeper.SWEEPABLE.has('sponsored'), false);

    // And the rules that must never relax.
    assert.equal(sweeper.SWEEPABLE.has('friend'), false);
    assert.equal(sweeper.SWEEPABLE.has('groupJoined'), false);
    assert.equal(sweeper.SWEEPABLE.has('unknown'), false);
  });

  test('the failure budget has room for an odd post', () => {
    // Tight enough to catch Facebook changing the menu, loose enough that one
    // unusual post type cannot cancel the whole queue behind it.
    assert.ok(sweeper.MAX_CONSECUTIVE_FAILURES >= 4, 'too tight trips on noise');
    assert.ok(sweeper.MAX_CONSECUTIVE_FAILURES <= 10, 'too loose keeps clicking blindly');
  });

  test('there is a daily ceiling', () => {
    assert.ok(sweeper.DAILY_CAP > 0, 'a runaway loop must have a floor to hit');
    assert.ok(sweeper.DAILY_CAP <= 500, 'the ceiling should be a sane one');
  });
})();
