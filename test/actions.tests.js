/**
 * The "Never show from this" shortcut.
 *
 * The point of these tests is the boundary, not the button. "Hide all from"
 * writes a permanent, unlistable preference to the account, so the extension
 * opens the menu and stops. Nothing here may ever click the item itself, and
 * nothing may attach the shortcut to a post the user chose.
 */
(function () {
  'use strict';

  const { test, assert } = globalThis.T;
  const actions = globalThis.FBF.actions;

  function withPost(html, fn) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      return fn(host.firstElementChild);
    } finally {
      host.remove();
    }
  }

  const POST = '<div class="post"><div role="button" aria-haspopup="menu"></div></div>';

  function result(type, extra) {
    return { type, confident: true, ...extra };
  }

  function shortcutIn(el) {
    return el.querySelector(`.${actions.BUTTON_CLASS}`);
  }

  test('the shortcut is off unless switched on', () => {
    actions.setEnabled(false);
    withPost(POST, (post) => {
      actions.attach(post, result('page'));
      assert.equal(shortcutIn(post), null, 'nothing may be injected by default');
    });
  });

  test('the shortcut appears on posts you did not choose', () => {
    actions.setEnabled(true);
    try {
      for (const type of ['page', 'sponsored', 'suggested', 'groupUnjoined']) {
        withPost(POST, (post) => {
          actions.attach(post, result(type));
          assert.ok(shortcutIn(post), `${type} should get the shortcut`);
        });
      }
    } finally {
      actions.setEnabled(false);
    }
  });

  test('the shortcut never appears on posts you chose', () => {
    actions.setEnabled(true);
    try {
      for (const type of ['friend', 'groupJoined']) {
        withPost(POST, (post) => {
          actions.attach(post, result(type));
          assert.equal(shortcutIn(post), null, `${type} must never be offered for hiding`);
        });
      }
    } finally {
      actions.setEnabled(false);
    }
  });

  test('the shortcut never appears on posts we could not read', () => {
    // Same rule as hiding: we cannot judge it, so we do not invite a permanent
    // decision about it.
    actions.setEnabled(true);
    try {
      withPost(POST, (post) => {
        actions.attach(post, result('unknown', { confident: false }));
        assert.equal(shortcutIn(post), null);
      });
    } finally {
      actions.setEnabled(false);
    }
  });

  test('nothing is injected into a post with no menu to open', () => {
    actions.setEnabled(true);
    try {
      withPost('<div class="post"></div>', (post) => {
        actions.attach(post, result('page'));
        assert.equal(shortcutIn(post), null, 'a shortcut that cannot work must not appear');
      });
    } finally {
      actions.setEnabled(false);
    }
  });

  test('the shortcut is not added twice', () => {
    actions.setEnabled(true);
    try {
      withPost(POST, (post) => {
        actions.attach(post, result('page'));
        actions.attach(post, result('page'));
        assert.equal(post.querySelectorAll(`.${actions.BUTTON_CLASS}`).length, 1);
      });
    } finally {
      actions.setEnabled(false);
    }
  });

  test('switching the shortcut off removes it from the page', () => {
    actions.setEnabled(true);
    withPost(POST, (post) => {
      actions.attach(post, result('page'));
      assert.ok(shortcutIn(post));
      actions.setEnabled(false);
      assert.equal(shortcutIn(post), null, 'the page must be left as we found it');
    });
  });

  test('our own control is marked so it cannot be read back as Facebook markup', () => {
    actions.setEnabled(true);
    try {
      withPost(POST, (post) => {
        actions.attach(post, result('page'));
        assert.equal(shortcutIn(post).getAttribute('data-fbf-ui'), '1');
      });
    } finally {
      actions.setEnabled(false);
    }
  });

  test('nothing happens until the shortcut is actually clicked', () => {
    // The boundary that matters: the extension never decides to hide a source
    // on its own. Attaching the control, classifying, scrolling — none of it
    // may write anything to the account.
    actions.setEnabled(true);
    try {
      withPost(POST, (post) => {
        let menuOpened = 0;
        post.querySelector('[aria-haspopup="menu"]').addEventListener('click', () => {
          menuOpened++;
        });

        actions.attach(post, result('page'));
        actions.attach(post, result('sponsored'));

        assert.equal(menuOpened, 0, 'merely showing the control must never act');
      });
    } finally {
      actions.setEnabled(false);
    }
  });

  test('one click acts on one post and no other', () => {
    actions.setEnabled(true);
    try {
      const html =
        '<div><div class="one"><div role="button" aria-haspopup="menu"></div></div>' +
        '<div class="two"><div role="button" aria-haspopup="menu"></div></div></div>';

      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.appendChild(host);
      try {
        const [one, two] = [host.querySelector('.one'), host.querySelector('.two')];
        let openedOne = 0;
        let openedTwo = 0;
        one.querySelector('[aria-haspopup="menu"]').addEventListener('click', () => openedOne++);
        two.querySelector('[aria-haspopup="menu"]').addEventListener('click', () => openedTwo++);

        actions.attach(one, result('page'));
        actions.attach(two, result('page'));
        one.querySelector(`.${actions.BUTTON_CLASS}`).click();

        assert.equal(openedOne, 1, 'the clicked post acts');
        assert.equal(openedTwo, 0, 'its neighbour must not');
      } finally {
        host.remove();
      }
    } finally {
      actions.setEnabled(false);
    }
  });

  test('the source name is read for the log', () => {
    // The log is what makes acting directly defensible, so it has to be able
    // to say what was hidden.
    withPost(
      '<div class="post"><div role="button" aria-haspopup="menu" ' +
        'aria-label="Open menu for Acme Beds sponsored content"></div></div>',
      (post) => {
        assert.equal(actions.sourceLabel(post), 'Acme Beds');
      },
    );
  });

  test('a nameless post still produces a log entry label', () => {
    withPost(POST, (post) => {
      assert.ok(actions.sourceLabel(post), 'must never be blank');
    });
  });

  test('the hide-all wording is recognised in other languages', () => {
    for (const label of [
      'Hide all from Acme',
      'Alles verbergen van Acme',
      'Tout masquer de Acme',
      'Ocultar todo de Acme',
      'Alles ausblenden von Acme',
    ]) {
      assert.equal(actions.HIDE_ALL.test(label), true, `${label} should match`);
    }
    assert.equal(actions.HIDE_ALL.test('Save post'), false);
  });
})();
