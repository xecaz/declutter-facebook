/**
 * A shortcut to Facebook's own "Hide all from …", on posts you did not choose.
 *
 * Where the line sits, and why it sits there:
 *
 * One click by you hides one source. That is a macro for a click you were
 * going to make anyway, and it is fine. What is not fine is the extension
 * deciding on its own: sweeping the feed and firing off account writes at
 * machine speed, unattended, on posts it may have misread. Nothing here runs
 * without a deliberate click on a specific post, and nothing here ever acts on
 * more than the post it was clicked on.
 *
 * "Hide all from" is a permanent preference and Facebook keeps no list of what
 * you have hidden, so every use is recorded locally — see the popup. That log
 * is the undo trail Facebook does not give you, and the reason acting directly
 * is defensible rather than reckless.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const BUTTON_CLASS = 'fbf-never-show';
  const CHOSEN = new Set(['friend', 'groupJoined']);

  /** "Hide all from …" across the languages Facebook's UI ships in. */
  const HIDE_ALL =
    /hide all|verberg alles|alles verbergen|tout masquer|masquer tout|ocultar todo|alles ausblenden|nascondi tutto|dölj alla|skjul alle/i;

  let enabled = false;

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) removeAll();
  }

  function isEnabled() {
    return enabled;
  }

  function attach(article, result) {
    try {
      if (!enabled || CHOSEN.has(result.type) || result.type === 'unknown') {
        remove(article);
        return;
      }
      if (article.querySelector(`:scope > .${BUTTON_CLASS}`)) return;

      // Nothing to point at if the post has no menu of its own.
      if (!article.querySelector('[aria-haspopup="menu"]')) return;

      article.appendChild(build(article, result));
      if (getComputedStyle(article).position === 'static') {
        article.style.position = 'relative';
      }
    } catch {
      // A convenience must never break the page.
    }
  }

  function build(article, result) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = 'Never show from this';
    button.title = 'Hide everything from this source, using Facebook’s own setting';

    // Marked so our own text is never mistaken for Facebook's markup by the
    // label detection in selectors.js.
    button.setAttribute('data-fbf-ui', '1');

    Object.assign(button.style, {
      position: 'absolute',
      top: '6px',
      right: '46px',
      zIndex: '9998',
      padding: '3px 8px',
      border: '1px solid rgba(128,128,128,0.45)',
      borderRadius: '999px',
      background: 'rgba(128,128,128,0.12)',
      color: 'inherit',
      font: '600 11px/1.5 system-ui, sans-serif',
      cursor: 'pointer',
      opacity: '0.75',
    });

    button.addEventListener('mouseenter', () => (button.style.opacity = '1'));
    button.addEventListener('mouseleave', () => (button.style.opacity = '0.75'));

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideAllFrom(article, button, result);
    });

    return button;
  }

  /**
   * A best-effort name for what is being hidden, for the local log.
   *
   * The menu's accessible name carries the advertiser or page on ads; failing
   * that, the first link in the post that names someone.
   */
  function sourceLabel(article) {
    try {
      const menu = article.querySelector('[aria-haspopup="menu"]');
      const label = menu && menu.getAttribute('aria-label');
      if (label) {
        const cleaned = label
          .replace(/^(open menu for|actions for|menu for)\s*/i, '')
          .replace(/\s*sponsored content$/i, '')
          .replace(/'s post$/i, '')
          .trim();
        if (cleaned && cleaned.length < 80) return cleaned;
      }

      for (const a of article.querySelectorAll('a[href]')) {
        if (a.hasAttribute('data-fbf-ui')) continue;
        const text = (a.textContent || '').trim();
        if (text && text.length < 80) return text;
      }
    } catch {
      /* a nameless entry is still worth logging */
    }
    return 'Unnamed source';
  }

  /**
   * Open the post's own menu and choose "Hide all from …".
   *
   * Acts on this post only, and only from a click on this post's button. The
   * menu has to be opened first because that is when Facebook mounts the item,
   * and it mounts it in a portal at document level rather than inside the post
   * — hence the search outside `article`.
   */
  function hideAllFrom(article, button, result) {
    const menu = article.querySelector('[aria-haspopup="menu"]');
    if (!menu) return;

    const label = sourceLabel(article);
    menu.click();
    button.textContent = 'Hiding…';

    let attempts = 0;
    const findAndClick = () => {
      attempts++;
      const items = document.querySelectorAll('[role="menuitem"], [role="menu"] [role="button"]');
      for (const item of items) {
        if (HIDE_ALL.test((item.textContent || '').trim())) {
          item.click();
          button.textContent = 'Hidden ✓';
          record(label, result && result.type);
          return;
        }
      }
      if (attempts < 15) {
        setTimeout(findAndClick, 100);
        return;
      }

      // The menu is open and the item is not in it — leave it open rather than
      // closing it, so the choice is still there to make by hand.
      button.textContent = 'Not offered here';
      setTimeout(() => {
        button.textContent = 'Never show from this';
      }, 4000);
    };
    setTimeout(findAndClick, 100);
  }

  /** Facebook keeps no record of what you have hidden. This one does. */
  function record(label, type) {
    try {
      FBF.storage.recordHidden({ label, type: type || 'page', at: Date.now() });
    } catch {
      /* the action already happened; failing to log it must not undo it */
    }
  }

  function remove(article) {
    const existing = article.querySelector(`:scope > .${BUTTON_CLASS}`);
    if (existing) existing.remove();
  }

  function removeAll() {
    try {
      for (const el of document.querySelectorAll(`.${BUTTON_CLASS}`)) el.remove();
    } catch {
      /* no-op */
    }
  }

  FBF.actions = {
    setEnabled, isEnabled, attach, removeAll, hideAllFrom, sourceLabel,
    BUTTON_CLASS, HIDE_ALL,
  };
})(globalThis.FBF);
