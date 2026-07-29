/**
 * Opt-in visual check: outline each post by how it was classified.
 *
 * This is the only part of the extension that touches Facebook's pixels, and
 * it is off by default. It exists because counts can be confidently wrong —
 * the only real way to know the classifier works is to look at a post you
 * recognise and see whether it got the right colour.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const COLORS = {
    friend: '#2e9e5b',
    groupJoined: '#3b7dd8',
    groupUnjoined: '#8d6fd1',
    page: '#c0782a',
    sponsored: '#c0392b',
    suggested: '#b03a8b',
    unknown: '#7a7a7a',
  };

  let enabled = false;

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) removeAll();
  }

  function isEnabled() {
    return enabled;
  }

  function mark(article, result) {
    if (!enabled) return;
    try {
      const color = COLORS[result.type] || COLORS.unknown;
      article.style.outline = `2px solid ${color}`;
      article.style.outlineOffset = '-2px';
      article.dataset.fbfDebug = result.type;

      if (article.querySelector(':scope > .fbf-debug-tag')) return;

      const tag = document.createElement('div');
      tag.className = 'fbf-debug-tag';
      tag.textContent = label(result);
      Object.assign(tag.style, {
        position: 'absolute',
        zIndex: '9999',
        margin: '4px',
        padding: '2px 6px',
        font: '600 11px/1.4 system-ui, sans-serif',
        color: '#fff',
        background: color,
        borderRadius: '3px',
        pointerEvents: 'none',
      });

      if (getComputedStyle(article).position === 'static') {
        article.style.position = 'relative';
      }
      article.appendChild(tag);
    } catch {
      // Debug chrome is never worth breaking the page over.
    }
  }

  function label(result) {
    const bits = [result.type];
    if (!result.confident) bits.push('?');
    if (result.disagreement) bits.push('!');
    if (result.strategy && result.strategy !== 'heading') bits.push(result.strategy);
    return bits.join(' ');
  }

  function removeAll() {
    try {
      for (const tag of document.querySelectorAll('.fbf-debug-tag')) tag.remove();
      for (const el of document.querySelectorAll('[data-fbf-debug]')) {
        el.style.outline = '';
        el.style.outlineOffset = '';
        delete el.dataset.fbfDebug;
      }
    } catch {
      /* no-op */
    }
  }

  FBF.overlay = { setEnabled, isEnabled, mark, removeAll, COLORS };
})(globalThis.FBF);
