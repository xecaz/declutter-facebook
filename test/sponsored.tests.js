/**
 * Ad detection, against the markup Facebook actually shipped.
 *
 * Two things were learned from a real ad and both are pinned here:
 *
 *  - the visible label is "Sponsored​" — padded with a zero-width space
 *    specifically to break text matching — and it sits outside the post header
 *    that marker detection used to search;
 *  - the reliable signal is the post menu's accessible name, "Open menu for
 *    <advertiser> sponsored content", which Facebook has to expose for screen
 *    readers and therefore cannot obfuscate the same way.
 *
 * Advertiser names below are invented; only the structure is real.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const S = globalThis.FBF.selectors;

  const ZWSP = '​';

  function withFixture(html, fn) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      return fn(host);
    } finally {
      host.remove();
    }
  }

  test('the zero-width padded visible label is detected', () => {
    withFixture(
      `<div class="post"><span><span>Sponsored${ZWSP}</span></span></div>`,
      (host) => {
        const markers = S.detectMarkers(host.firstElementChild);
        assert.equal(markers.sponsored, true, 'U+200B padding must not defeat matching');
        assert.equal(markers.sponsoredVia, 'label');
      },
    );
  });

  test('the menu accessible name is detected', () => {
    withFixture(
      '<div class="post">' +
        '<div role="button" aria-label="Open menu for Acme Beds sponsored content"></div>' +
        '</div>',
      (host) => {
        const markers = S.detectMarkers(host.firstElementChild);
        assert.equal(markers.sponsored, true);
        assert.equal(markers.sponsoredVia, 'aria-label');
      },
    );
  });

  test('the label is found outside the post header', () => {
    // The real ad had the label well below the header region, which is why
    // searching only the header found nothing.
    withFixture(
      '<div class="post">' +
        '<h3><a href="/some.page">Acme</a></h3>' +
        '<div><div><div><span>Sponsored' + ZWSP + '</span></div></div></div>' +
        '</div>',
      (host) => {
        assert.equal(S.detectMarkers(host.firstElementChild).sponsored, true);
      },
    );
  });

  test('ordinary posts are not mistaken for ads', () => {
    withFixture(
      '<div class="post">' +
        '<h3><a href="/jane.doe">Jane</a></h3>' +
        '<a href="/jane.doe/posts/123456789">2 h</a>' +
        '<div>A post that happens to mention a sponsor of the local team.</div>' +
        '</div>',
      (host) => {
        // Long prose must not match; only short standalone labels do.
        assert.equal(S.detectMarkers(host.firstElementChild).sponsored, false);
      },
    );
  });

  test('ads are found as posts despite having no author or permalink', () => {
    // The real ad had neither: the advertiser is named only in the menu's
    // accessible name, so anchoring on authorship missed every ad and left
    // them out of the denominator entirely.
    const feed =
      '<div>' +
      '<div class="realpost">' +
      '<h3><a href="/jane.doe">Jane</a></h3>' +
      '<a href="/jane.doe/posts/111111111">2 h</a>' +
      '<div role="button" aria-haspopup="menu" aria-label="Actions for this post"></div>' +
      '</div>' +
      '<div class="advert">' +
      '<div role="button" aria-haspopup="menu" aria-label="Open menu for Acme Beds sponsored content"></div>' +
      '<div>Buy a bed</div>' +
      '</div>' +
      '</div>';

    withFixture(feed, () => {
      const posts = S.findArticles(document);
      assert.equal(posts.length, 2, 'the ad must be counted as a post too');

      const sponsored = posts.filter((p) => S.detectMarkers(p).sponsored);
      assert.equal(sponsored.length, 1, 'exactly one of them is an ad');
    });
  });

  test('a Follow button is treated as proof the post is unchosen', () => {
    // A header reading "Some Page · Follow" — a page you do not follow.
    // Facebook does not offer to follow something you already follow, so this
    // settles the post without needing to read the author at all.
    withFixture(
      '<div class="post">' +
        '<span>Some Page</span><span>·</span>' +
        '<div role="button">Follow</div>' +
        '</div>',
      (host) => {
        assert.equal(S.detectMarkers(host.firstElementChild).followButton, true);
      },
    );
  });

  test('Follow is recognised in other languages', () => {
    for (const label of ['Volgen', 'Folgen', 'Suivre', 'Seguir', 'Följ']) {
      withFixture(`<div class="post"><div role="button">${label}</div></div>`, (host) => {
        assert.equal(
          S.detectMarkers(host.firstElementChild).followButton,
          true,
          `${label} should count as a follow button`,
        );
      });
    }
  });

  test('Join is recognised, and is kept separate from Follow', () => {
    // They prove different things. Follow says you do not follow this page;
    // only Join says you are not a member of this group. A group you belong to
    // can still offer to follow its posts, so merging the two made such a
    // group look unchosen whenever the index had not got it.
    for (const label of ['Join', 'Lid worden', 'Beitreten', 'Rejoindre']) {
      withFixture(`<div class="post"><div role="button">${label}</div></div>`, (host) => {
        const markers = S.detectMarkers(host.firstElementChild);
        assert.equal(markers.joinButton, true, `${label} should be a join button`);
        assert.equal(markers.followButton, false, `${label} is not a follow button`);
      });
    }
  });

  test('the word "follow" in post text is not a follow button', () => {
    withFixture(
      '<div class="post"><div>Please follow the instructions in the comments below.</div></div>',
      (host) => {
        assert.equal(S.detectMarkers(host.firstElementChild).followButton, false);
      },
    );
  });

  test('posts are found by their menu even without author or permalink', () => {
    const feed =
      '<div>' +
      '<div class="a"><div role="button" aria-haspopup="menu"></div>' +
      '<span>Some Page</span><div role="button">Follow</div></div>' +
      '<div class="b"><div role="button" aria-haspopup="menu"></div>' +
      '<h3><a href="/jane.doe">Jane</a></h3></div>' +
      '</div>';

    withFixture(feed, () => {
      assert.equal(S.findArticles(document).length, 2);
    });
  });

  test('page furniture with a menu is not counted as an ad', () => {
    // The navigation bar has menus too; only regions carrying a sponsored
    // marker qualify.
    withFixture(
      '<div role="navigation">' +
        '<div role="button" aria-haspopup="menu" aria-label="Account"></div>' +
        '</div>',
      () => {
        assert.equal(S.findArticles(document).length, 0);
      },
    );
  });
})();
