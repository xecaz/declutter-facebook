/**
 * A test runner in about eighty lines, so the tests need nothing installed.
 *
 * Open test/index.html in Chrome and the results render on the page. No
 * runtime, no package manager, no dependencies — the same reason the extension
 * itself has none.
 *
 * Uses only script tags and DOM APIs: no eval, no fetch, so it runs equally
 * well from file:// or from inside the extension, where Manifest V3's default
 * content security policy would block both.
 */
globalThis.T = (function () {
  'use strict';

  const tests = [];
  let current = null;

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function fmt(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function fail(message) {
    throw new Error(message);
  }

  const assert = {
    equal(actual, expected, message) {
      if (!Object.is(actual, expected)) {
        fail(message ? `${message} — expected ${fmt(expected)}, got ${fmt(actual)}`
                     : `expected ${fmt(expected)}, got ${fmt(actual)}`);
      }
    },
    notEqual(actual, unexpected, message) {
      if (Object.is(actual, unexpected)) {
        fail(message || `expected something other than ${fmt(unexpected)}`);
      }
    },
    ok(value, message) {
      if (!value) fail(message || `expected a truthy value, got ${fmt(value)}`);
    },
    match(value, regex, message) {
      if (typeof value !== 'string' || !regex.test(value)) {
        fail(message || `expected ${fmt(value)} to match ${regex}`);
      }
    },
  };

  function run(mount) {
    const results = [];
    for (const { name, fn } of tests) {
      current = name;
      try {
        fn();
        results.push({ name, ok: true });
      } catch (error) {
        results.push({ name, ok: false, error: error && error.message ? error.message : String(error) });
      }
    }
    current = null;
    render(mount, results);
    return results;
  }

  function render(mount, results) {
    const failed = results.filter((r) => !r.ok);

    const summary = document.createElement('div');
    summary.className = failed.length ? 'summary bad' : 'summary good';
    summary.textContent = failed.length
      ? `${failed.length} of ${results.length} tests failed`
      : `All ${results.length} tests passed`;
    mount.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'results';
    for (const result of results) {
      const item = document.createElement('li');
      item.className = result.ok ? 'ok' : 'bad';

      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = result.ok ? '✓' : '✗';
      item.appendChild(mark);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = result.name;
      item.appendChild(name);

      if (!result.ok) {
        const why = document.createElement('div');
        why.className = 'why';
        why.textContent = result.error;
        item.appendChild(why);
      }

      list.appendChild(item);
    }
    mount.appendChild(list);
  }

  return { test, assert, run, get currentTest() { return current; } };
})();
