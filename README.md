# Feed Filter

A browser extension for Chrome and Firefox that gives you back the Facebook
feed you actually chose:
posts from friends you added and groups you joined. Everything else can be
counted, greyed out, hidden, or permanently opted out of — your choice, one
setting at a time.

No dependencies, no build step, nothing leaves your machine.

---

## Where this is at

It started as a measurement-only tool, because the design rested on an
assumption worth testing: that there was enough friend and group content in the
home feed to be worth filtering *for*.

**There is not.** Measured over a real feed, roughly **one post in six** came
from a friend or a joined group — and that was before ads were being counted at
all, so the true share is lower. Four in five posts were things the user never
asked for.

That answered the design question and settled the direction: dimming most of a
feed is pointless, so the extension now hides, and can tell Facebook to stop
sending a source altogether. The measurement side is still there and still
running — it is how you tell whether the classifier is working.

---

## Install

Runs on both Chrome and Firefox from the same folder — no build step, no
separate branch.

### Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder

Chrome will not let an extension pin its own icon. To keep it visible, click
the puzzle-piece button in the toolbar and pin **Feed Filter**.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select `manifest.json` in this folder
3. Click the extension's toolbar button and choose **Always Allow on
   facebook.com**

That third step is not optional and has no Chrome equivalent. **Firefox treats
Manifest V3 host permissions as opt-in**: the extension is installed but can
see nothing until you grant it the site, and until you do it will simply report
"No reply from this tab" on every Facebook page.

Temporary add-ons are removed when Firefox restarts. To keep it installed you
either need it signed through addons.mozilla.org, or a Firefox ESR / Developer
Edition build with `xpinstall.signatures.required` set to `false`, into which
you can drop a zipped `.xpi`.

### Packaged build

`dist/feed-filter-<version>.zip` is the same tree, zipped. One archive serves
both browsers:

- **Chrome** — unzip it and *Load unpacked*, or drag the `.zip` onto
  `chrome://extensions`
- **Firefox** — rename it to `.xpi`. It installs directly on a build that
  allows unsigned add-ons (ESR or Developer Edition with
  `xpinstall.signatures.required` set to `false`); otherwise it needs signing
  through addons.mozilla.org first.

Rebuild it after changing the version in `manifest.json`:

```sh
python3 - <<'EOF'
import zipfile, pathlib, json
root = pathlib.Path('.')
version = json.loads((root/'manifest.json').read_text())['version']
skip_dirs, skip_files = {'.git', 'dist'}, {'.gitignore'}
files = sorted(f for f in root.rglob('*') if f.is_file()
               and not skip_dirs & set(f.parts) and f.name not in skip_files
               and f.suffix not in {'.zip', '.xpi'})
with zipfile.ZipFile(root/'dist'/f'feed-filter-{version}.zip', 'w',
                     zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        # Fixed timestamps: same source in, byte-identical archive out, so a
        # rebuild does not show up as a change in git for no reason.
        i = zipfile.ZipInfo(str(f.relative_to(root)), date_time=(2026, 7, 29, 0, 0, 0))
        i.compress_type, i.external_attr = zipfile.ZIP_DEFLATED, 0o644 << 16
        z.writestr(i, f.read_bytes())
EOF
```

### How the one folder serves both

Three things differ, and all three are handled in the source rather than by
maintaining two copies:

- **The API namespace.** Firefox provides the promise-based `browser`; Chrome
  provides `chrome`, which also returns promises under MV3. `src/lib/browser-api.js`
  resolves whichever exists once, so every call site can just `await`.
- **The background script.** Chrome runs a service worker; Firefox MV3 uses an
  event page. The manifest declares `background.service_worker` *and*
  `background.scripts` — each browser reads its own key and ignores the other.
- **Loading dependencies.** `importScripts` exists in a service worker but not
  on a Firefox event page, so `worker.js` guards the call and Firefox lists the
  same files in `background.scripts` instead.

> **Reload your Facebook tabs after loading or reloading the extension.**
> Chrome only injects content scripts into pages opened *after* the extension
> starts, so a tab that was already open is not running it. The popup's top
> line says **"No reply from this tab"** when that is the case, and shows
> Chrome's own error underneath — that line is the first thing to check
> whenever nothing seems to be happening.

---

## Use

### 1. Build your index

Open each of these and scroll to the bottom:

- <https://www.facebook.com/friends/list> — "All friends"
- <https://www.facebook.com/groups/joins> — "Your groups"

The extension reads rows as they render. It does not scroll for you. Scrolling
to the bottom once is all it takes, and the popup shows a running count plus a
"last pass" timestamp so you can see it working rather than guess.

> These two exact URLs matter. The `/friends` landing page mixes in friend
> requests and "People you may know", and `/groups/feed` shows suggested
> groups — capturing on either would put strangers into your allowlist.

**Re-capture your groups occasionally.** The index is a snapshot; a group you
joined last week looks exactly like one you were never in until you capture
again.

### 2. Pick what happens to the rest

Popup → **Leave them / Dim / Hide**.

Two further opt-ins, both off by default:

- **Also act on posts I could not read** — posts nothing could be extracted
  from. Most likely to be a friend we failed to parse, hence off.
- **"Never show from this" button** — adds a one-click control to unchosen
  posts that tells Facebook to hide everything from that source.
- **Automatically hide every unchosen source** — see *Acting on Facebook*.

### 3. Check it is actually right

Turn on **"Outline posts on the page by classification"** and scroll. Every
post gets a coloured outline. Look at posts you personally recognise — counts
can be confidently wrong, and this is the only way to know.

| Colour | Meaning |
| --- | --- |
| Green | A friend in your index |
| Blue | A group you joined |
| Purple | A group you have not joined |
| Orange | A page or a stranger |
| Red | Sponsored |
| Magenta | Suggested |
| Grey | Could not be read |

`?` means the author came from a loose fallback; `!` means the index and the
visible label disagree.

### The popup's top line

It reports what the current tab is doing, and when something is wrong it names
which half is broken rather than guessing:

| Popup says | Meaning |
| --- | --- |
| Counting the home feed | Working. Shows posts on screen and how many have a readable author |
| Capturing friends / groups — *N* found | Working. Keep scrolling |
| No reply from this tab | Reload the tab. Chrome's own error is shown underneath |
| Running, but broken in this tab | The script answered but a module failed to load — it names which |
| On the right page, but reading nothing | Route match is fine, selectors have rotted. Shows a structural breakdown and a verdict |
| Finding posts, but cannot read who wrote them | Feed selectors have rotted. Same breakdown |
| Nothing to do on `/some/path` | Wrong page — and it shows which one you are on |

---

## How it decides

### Allowlist, not blocklist

Most "clean up Facebook" extensions chase a blocklist — hide `Sponsored`, hide
`Suggested for you`, hide Reels — and break every time Facebook invents a new
category or obfuscates a label further. That is a race against a team that
ships daily.

This one inverts the question. Instead of *"is this one of the N things
Facebook injects?"* it asks *"is this someone I picked?"*, checked against an
index you built yourself. That only breaks when the DOM structure changes, not
when Facebook invents a new kind of content, and it works in any interface
language.

### Priority

1. **Sponsored** beats everything, so an ad can never be counted as yours.
2. **A group you joined** beats authorship — a stranger posting there is still
   content you signed up for.
3. **A friend** beats an unjoined group. A friend stays a friend wherever they
   post; applying the group rule in both directions dimmed a friend's post
   because of the room it happened to appear in.
4. Then suggested labels, Follow buttons, and finally a readable author who is
   simply not in your index.

### What is enough to act on

**Something must actively say you are not connected to the source.** Absence
from the index does not count.

That distinction took three separate bugs to learn. The index holds your
friends and the groups you joined — **it has no record of the pages you follow
at all**, and it goes stale for groups the moment you join a new one. So "we
have no record of this" was convicting pages the user had deliberately
followed, and those show no Follow button *precisely because* they are already
followed.

Evidence that counts:

- a **Follow** button — you do not follow this page;
- a **Join** button — you are not in this group, and only Join settles a group,
  since a group you belong to can still offer to follow its posts;
- a **"Suggested for you"** label;
- a **sponsored** marker.

Friends and joined groups are never touched, under any setting, by any rule.

The cost is that an unchosen source showing no button at all survives. That is
the right way round: the failure becomes a post you did not want and can
dismiss, rather than a post you did want and never learn existed.

### Languages

The allowlist itself is language-independent — it compares identifiers, not
words. The signals layered on top of it are not, so the labels Facebook renders
are matched across the languages its interface ships in: Follow and Join in
around twenty European languages, and the sponsored and suggested markers in a
dozen. **You do not need to switch Facebook to English.**

Two details make that maintainable rather than a list to keep fighting with:

- **Labels are folded before comparison** — lowercased, accents stripped — so
  one entry covers a word however it is written, and an inconsistent diacritic
  in Facebook's markup cannot cause a miss. `Följ`, `Sledovať` and `Alătură-te`
  need no special handling.
- **Letters that are not accented bases are mapped by hand.** Stripping
  combining marks does nothing for Danish `ø`, Polish `ł`, Turkish dotless `ı`
  or German `ß`, because those are their own characters rather than decorated
  ones. Forgetting them is exactly how `Følg` and `Dołącz` went unrecognised
  until the tests caught it.

Follow and Join labels are matched **whole**, never as substrings, which is what
stops a post that merely contains the word "follow" from being read as carrying
a Follow button. The sponsored and suggested markers are matched on stems, but
only ever against short standalone labels and accessible names — never against
post text.

Adding a language means adding a string to `FOLLOW_LABELS` or `JOIN_LABELS` in
`src/lib/selectors.js`. `test/sponsored.tests.js` covers each one, and a wrong
guess fails there rather than in your feed.

---

## Acting on Facebook

Everything above is local and reversible. This section is not.

### The "Never show from this" button

Optional. Adds a control to unchosen posts that uses Facebook's own "Hide all
from…" setting. One click.

### Automatic sweep

Optional, off by default, and a genuine change in kind: the extension issues
"Hide all from…" for each new page, group or person your feed shows you,
without asking each time.

**The original rule here was "no synthetic clicks", and that rule has been
deliberately retired.** It turned out to be drawn in the wrong place. What
matters is not whether a click is synthetic — it is who decided, how many
things get decided at once, and whether the result can be reviewed. A macro for
a click you were going to make anyway is not the same as a program sweeping
your account unattended, and pretending otherwise made the rule useless as a
guide.

So the safeguards target what actually matters:

- **One source, once**, keyed on author or group id. A page with forty posts is
  actioned once, not forty times.
- **Serialised.** Facebook mounts one menu at a time in one portal; overlapping
  attempts would click the wrong item.
- **Paced** — several seconds apart with jitter, and only while the tab is
  visible.
- **Capped per day** (`DAILY_CAP` in `sweeper.js`), so a bug cannot run
  away with the account.
- **Stops itself** after five consecutive failures to find the menu item,
  rather than clicking blindly into changed markup.
- **Ads are not swept.** Facebook's ad menu offers *Hide ad*, not "Hide all
  from", so every ad was a guaranteed miss — and misses in a row are what stops
  the sweep, so two ads could cancel everything queued behind them. They are
  also not worth an account write: there is an endless supply of advertisers,
  whereas a page or group keeps returning. Ads are still hidden locally.
- Sources with no identifiable key are skipped rather than guessed at.

**Every use is logged locally** and shown in the popup, broken down by kind.
Facebook applies "Hide all from" permanently, applies it to your phone too, and
keeps **no list** of what you have hidden — so that log is the only record, and
the only way to review a decision or spot a mistaken one. It is what makes
acting directly defensible rather than reckless.

To undo one: **Settings → News Feed → Reconnect** on Facebook.

The residual risk is yours to weigh and worth stating plainly: automated
interaction is against Facebook's terms, and account actions are possible.

---

## What it still never does

1. **No automated collection.** No auto-scrolling, no background navigation, no
   opening pages you did not open. Reading DOM that Facebook already rendered
   for a page you visited is ordinary client-side behaviour.
2. **No network requests.** No `fetch`, no `XMLHttpRequest`, no GraphQL. The
   only permissions are `storage` and `https://*.facebook.com/*` — and on
   Firefox the latter is opt-in, granted by you per site.
3. **Nothing leaves this machine.** Everything is `chrome.storage.local`. No
   server, no sync, no telemetry. Your index is a list of your friends — treat
   it as sensitive.
4. **No post text is ever stored.** Only keys, classifications, counts, and
   which selector strategy matched. Text is hashed in memory for deduplication,
   then discarded.
5. **Never break the feed.** Every entry point is wrapped; failure degrades to
   doing nothing, never to a broken page.

---

## Field notes on Facebook's markup

Hard-won, counter-intuitive, and each one cost a debugging round. All are
pinned by tests.

**Two empty `role="main"` elements.** On `/friends/list`, Facebook renders two
of them, both completely empty, and puts the friend rows inside
`role="navigation"`. Scoping capture to `role="main"` — the obvious,
semantically correct choice — reads an empty container and reports nothing on a
page holding hundreds of friends. Capture prefers `main` but falls back to the
whole page when it yields nothing. **The test is "did we find anything", not
"does the element exist"**; that distinction was the entire bug.

**Never observe a container that might be empty.** The same empty `main` was
the MutationObserver target, and an observer on a container that never mutates
never fires — so capture ran once and stopped, silently.

**Throttle, never debounce.** A debounce resets its timer on every mutation.
Facebook mutates continuously, so the pass is cancelled forever and the index
freezes at whatever the first screenful held. `test/throttle.tests.js`
demonstrates the failure next to the fix.

**A post is a shape, not a role.** `role="article"` is used when present, but
Facebook also ships *empty* `role="article"` placeholders. The most reliable
anchor is the post's own ⋯ menu (`aria-haspopup="menu"`), grown outward to the
largest region containing exactly one menu — that finds posts with no author,
no permalink and no heading, which authorship-based detection cannot see at all.

**Ads are invisible to author-based detection.** They carry no author link and
no permalink; the advertiser is named only in the menu's accessible name. Left
out, they vanish from the denominator and flatter the headline percentage.

**The sponsored label is booby-trapped.** It renders as `"Sponsored​"` — padded
with a zero-width space to break text matching — and sits outside the post
header. The reliable signal is the menu's accessible name, `"… sponsored
content"`, which Facebook must expose for screen readers.

**A fingerprint that cannot distinguish two posts must refuse to answer.**
Hashing author + header collapsed every unreadable post to one value, so the
first was counted and all the rest discarded as duplicates. The feed total
froze at 1 while scrolling continued.

**Follow and Join are different signals.** A group you belong to can still
offer to follow its posts, so Follow must never stand in for Join.

---

## When it breaks

It will. Facebook reshapes its markup roughly weekly and its class names are
rotating hashes.

Everything that knows what Facebook's DOM looks like is in one file —
**`src/lib/selectors.js`** — and nothing else matches on a class name. Lookups
are layered, most precise first, and which strategy fired is reported so the
popup can show when we have quietly degraded to guessing.

The popup is the early warning:

- **Health → "posts we could not read"** above 10% means `selectors.js` needs
  attention and the percentage should not be trusted until it drops.
- **The top line** shows a structural breakdown and a plain-language verdict
  when reading fails — how many links exist, how many parse, whether posts have
  headings — so you know *which* assumption broke.

---

## Known limitations

- Label detection (`Sponsored`, `Suggested for you`) covers several languages
  but not all, and Facebook actively obfuscates the sponsored label. The
  headline metric does not depend on it.
- The index has no record of **pages you follow** — only friends and groups.
  This is why acting requires positive evidence rather than absence from the
  index.
- Two Facebook tabs at once can race on a stats write and lose a few counts.
- Deduplication remembers the last 5,000 posts per tab; a very long session can
  count a post twice. Reloading resets it.
- If your friends list page ever renders suggestions, strangers could enter the
  index. The popup shows recently captured names as a spot check; **Clear
  index** and rebuild if something looks wrong.

---

## Layout

```
manifest.json
icons/
src/
  lib/
    browser-api.js   Resolves Firefox's `browser` or Chrome's `chrome`, once
    keys.js          URL -> stable profile/group/story key (strips FB tracking params)
    selectors.js     The ONLY file that knows Facebook's DOM
    storage.js       chrome.storage.local: index, counts, hidden log, settings
  content/
    index.js         Bootstrap: routes, settings, status replies, error boundary
    feed-scanner.js  Find posts, dedupe, count
    classify.js      The decision table
    index-capture.js Passive friends/groups capture
    filter.js        Dim / hide, and the rule for what may be touched
    actions.js       The "Never show from this" button
    sweeper.js       The automatic sweep, and its safeguards
    debug-overlay.js Opt-in classification outlines
  background/
    worker.js        Toolbar badge, nothing else (service worker / event page)
  popup/             The entire user interface
test/
  index.html         Open this in Chrome to run the tests
  harness.js         ~80-line test runner
  stub-selectors.js  Stands in for the DOM so classify.js can be tested
  keys.tests.js      Key normalization
  classify.tests.js  The decision table and its priority order
  selectors.tests.js Capture, against fixtures copied from real Facebook markup
  sponsored.tests.js Ad detection, and Follow vs Join
  filter.tests.js    What may be dimmed or hidden — and what never may
  actions.tests.js   The one-click shortcut, and its limits
  sweeper.tests.js   The automatic sweep: restraint, not capability
  throttle.tests.js  Why capture is throttled and not debounced
```

---

## No dependencies, no build step

There is no `package.json`, no `node_modules`, no bundler, nothing to install.
Chrome loads these files exactly as written. There is no third-party code in
the shipped extension and no toolchain that could introduce any.

Partly a supply-chain decision, partly a maintenance one: the code that reads
Facebook's markup needs editing every few weeks, and a build step is one more
thing to have rotted by the time you come back to it.

---

## Tests

Open **`test/index.html`** in Chrome. Results render on the page. **106 tests**
at last run.

Two ways in:

- Straight from disk — open the file or drag it into a tab
- From inside the extension — `chrome-extension://<your-extension-id>/test/index.html`

The runner is a small local script using plain script tags and DOM APIs. No
runtime, no eval, no network.

The suite passes in **both Chrome and Firefox** — worth running in each, since
they are different JavaScript engines and a syntax or behaviour difference
would show up nowhere else.

Coverage is the logic where a silent mistake would look like correct behaviour:
key normalization, the classification priority order, what may and may not be
hidden, and the sweep's restraints. DOM fixtures are structural copies of real
Facebook markup — synthetic names and URLs, real shapes.

Live DOM reading is deliberately not covered here; the debug overlay on a real
feed is how that gets verified, because a stubbed DOM would only test the stub.
