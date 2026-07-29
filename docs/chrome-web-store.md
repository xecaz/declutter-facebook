# Chrome Web Store listing — answers for the Privacy tab

Copy-paste answers for the developer dashboard, with the reasoning behind each
so you can defend them if a reviewer pushes back. Everything here is checked
against what the code actually does; if you change the extension's behaviour,
re-check this file.

---

## Single purpose

> Feed Filter shows which posts in the Facebook home feed come from friends the
> user added and groups the user joined, and lets the user dim, hide or opt out
> of the rest.

Keep it to that one sentence. The single-purpose rule is about narrowness — the
counting, dimming, hiding and opt-out are all the same purpose (controlling
what appears in your own feed), not four purposes, and it reads that way.

---

## Permission justifications

### `storage`

> Stores, on the user's own device, the list of friends and groups the user has
> captured from their own Facebook pages, the user's settings, daily counts of
> what their feed contained, and a log of the sources they chose to hide. The
> extension needs this to recognise which posts come from sources the user
> selected. It uses `storage.local` only — never `storage.sync` — so the data
> stays on that one device and is never transmitted anywhere.

### Host permission — `https://*.facebook.com/*`

> The extension's entire function takes place on facebook.com. It reads the
> rendered page to determine who authored each post, and changes the display of
> posts the user has chosen to hide. It is not active on any other site, makes
> no network requests of any kind, and does not read credentials, messages or
> any part of the page unrelated to identifying the author of a post.

### Remote code

**Answer: No, I am not using remote code.**

> All code is contained in the package. The extension loads no scripts at
> runtime, uses no `eval`, and has no dependencies, bundler or build step.

---

## Data usage disclosures

**Leave every category unchecked**, and answer "no" to collection.

Chrome's definition of *collect* is obtaining or transferring user data **off
the user's device**. This extension transmits nothing — it has no server and
makes no network requests at all — so none of the categories apply:

| Category | Answer |
| --- | --- |
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

**If a reviewer queries the last two**, the answer is that the extension reads
page content locally to classify a post and then discards it. Post text is
never written to storage and never leaves the device; what persists is limited
to identifiers and names the user captured from their own friends and groups
pages, plus counts and settings. That distinction is exactly what the privacy
policy sets out, which is why the policy is worth pointing at in any reply.

---

## Certifications

All three can be affirmed truthfully:

- ☑ I do not sell or transfer user data to third parties, outside of the
  approved use cases — *nothing is transferred anywhere at all.*
- ☑ I do not use or transfer user data for purposes unrelated to my item's
  single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

---

## Privacy policy URL

Upload `docs/privacy-policy.html` to your server and put its URL here. Replace
the `CONTACT@EXAMPLE.COM` placeholder in that file first — the store requires a
working contact.

If you enable GitHub Pages for this repository with the `/docs` folder as the
source, the file is served automatically at
`https://<username>.github.io/<repo>/privacy-policy.html`, which is a valid
policy URL and needs no server of your own.

---

## Worth putting in the store description, not the privacy tab

Two behaviours are not data collection, but they surprise people if
undisclosed, and surprise is what generates complaints and removals:

- The **"Never show from this"** button and the **automatic sweep** use
  Facebook's own "Hide all from…" setting. That changes a preference on the
  user's Facebook account, applies everywhere including their phone, and is
  reversed on Facebook rather than in the extension. Both are off by default.
- The automatic sweep acts **without asking each time** once enabled.

State both plainly in the listing. Consider shipping the automatic sweep
disabled — it already defaults to off — or leaving it out of the public build
entirely: automated interaction is against Facebook's terms, and it is the
feature most likely to attract a complaint from Meta after the listing is live.

---

## Before you submit

- [ ] Replace the contact address in `docs/privacy-policy.html`
- [ ] Replace the icon — it currently uses Facebook's brand mark and colour,
      which is a trademark problem for a public listing
- [ ] Avoid "Facebook" in the extension name; describing compatibility in the
      description is normal and fine
- [ ] Category: **Social & Communication**
