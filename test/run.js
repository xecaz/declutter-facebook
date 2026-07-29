/**
 * Runs everything registered by the *.tests.js files and renders the results.
 * A separate file rather than an inline script, because Manifest V3's default
 * content security policy blocks inline script on extension pages.
 */
globalThis.T.run(document.getElementById('results'));
