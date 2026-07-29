/**
 * One extension API object, whichever browser we are in.
 *
 * Firefox exposes the standard promise-based `browser`; Chrome exposes
 * `chrome`, which also returns promises under Manifest V3. Firefox *does* also
 * provide a `chrome` alias, but its semantics have historically been
 * callback-based, so preferring `browser` where it exists means every call
 * site can simply `await` and never think about it again.
 *
 * Resolving to null rather than throwing matters for the test page: it loads
 * storage.js outside any extension context, where neither object exists.
 * Callers that genuinely need the APIs fail at the point of use, with a
 * message saying so, instead of taking the whole file down at load time.
 */
globalThis.FBF = globalThis.FBF || {};
(function (FBF) {
  'use strict';

  const api = globalThis.browser || globalThis.chrome || null;

  FBF.api = api;

  /** True only inside a real extension context. */
  FBF.hasExtensionApis = Boolean(api && api.storage && api.storage.local);

  /** Which browser we are running in, for the odd place it matters. */
  FBF.isFirefox = Boolean(globalThis.browser && !globalThis.chrome);
})(globalThis.FBF);
