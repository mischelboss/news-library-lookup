# Spiegel via VÖBB

A Firefox extension prototype that checks paid articles on the Spiegel homepage and adds links to corresponding records in VÖBB's Genios service.

**Status:** authenticated background searches, article links, and the homepage prototype have been tried successfully in a real Firefox session. This is an unsigned prototype using an internal website endpoint, not an official VÖBB, Genios, or Spiegel product.

## Load it in Firefox

1. Clone this repository, or download and extract its source ZIP.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…** and select `extension/manifest.json`.
4. Allow access to Spiegel and VÖBB Genios when Firefox requests it. If needed, review the extension's Permissions tab in `about:addons`.
5. Sign in normally at https://bib-voebb.genios.de/ in the same Firefox profile. A private window or isolated container might not share its session with extension background requests.
6. Open or reload https://www.spiegel.de/.

Temporary add-ons disappear on Firefox restart. Reload them through about:debugging while developing. Version 0.3.0 changed the extension ID to `@spiegel-voebb`; remove any older temporary prototype first so you edit the source you actually load. Firefox 140 or later is required.

## Badges

| Badge | Meaning |
| --- | --- |
| Über VÖBB lesen | A strong, unambiguous title match in SPIEGEL Plus; opens its Genios record in the current tab |
| In Genios suchen | No sufficiently confident match; opens a manual search in the current tab |
| VÖBB anmelden / erneut prüfen | A session, permission, or network problem interrupted searching |

A direct badge signals a title match, not guaranteed reading rights. Genios checks full-text access when the document opens.

The popup has **Pause checks**, **Retry failed**, and **Clear cache** controls. After signing in again, choose **Retry failed** to re-check failed badges without reloading; successful badges are not queried again. After clearing the cache, reload Spiegel. Background searches create no tabs. An already-running request may finish after pausing.

The popup status names the last failure category (for example `network`, `HTTP 503`, `timeout`, `content-type`, `json`, or `shape`). The background console logs the same category only, never queries, URLs, headers, cookies, or response bodies.

## Install a signed package

You do not need the repository to use a signed package. The maintainer provides a signed `spiegel-voebb-<version>.xpi` (see docs/releasing.md for how it is made). The extension is Firefox desktop only for now.

1. Use Firefox 140 or later on a computer.
2. Open the `.xpi` in Firefox (drag it onto a window, or File → Open File) and read the permission prompt. It lists access to VÖBB Genios and Spiegel and the data collected ("website content": the headlines sent to Genios).
3. After adding it, the setup page opens. Sign in to https://bib-voebb.genios.de/ in the same Firefox profile with your own VÖBB account, then open https://www.spiegel.de/.
4. To update, open the newer `.xpi` the same way. Settings and cache are kept.

Each person uses their own library account. Nothing is shared between users or through GitHub.

## Work on another device

```sh
git clone https://github.com/mischelboss/spiegel-voebb.git
cd spiegel-voebb
npm run check
npm test
```

Each checkout or worktree that you use for browser testing should be loaded into Firefox using its own `extension/manifest.json`. Firefox loads that local folder; editing a different worktree will not update the installed extension.

Before switching devices, commit and push your work. On the other device, fetch/pull the branch before editing. The project instructions in AGENTS.md travel with the repository.

Sign into VÖBB separately on each device. GitHub syncs source code, tests, and documentation; it does not sync your library login or local search cache.

## Development

Requirements: Node.js 22+ for checks/tests, and Python 3 for ZIP packaging. No npm dependencies or installation step are required.

```sh
npm run check
npm test
npm run package
```

Packaging writes `dist/spiegel-voebb-<version>.zip` from the explicit allowlist in `scripts/package-files.json`. `npm run check` fails if an extension file or a file referenced by the manifest or popup is missing from that list. In environments where Python is named `python` rather than `python3`, run `python scripts/package.py` directly.

CI runs the same checks, tests, and packaging, then uploads a downloadable extension ZIP as a workflow artifact. It does not call Genios or publish to a browser store.

After editing, click **Reload** for the extension in about:debugging, then reload Spiegel. Use **Inspect → Console** for background diagnostics. Do not export or commit authentication headers or cookies.

## Matching and requests

- Only homepage paths `/` and `/index.html` are processed.
- Detect paid cards using Spiegel's explicit `spon` / `plus-paid` attributes.
- Read the accessible card title, with heading-link fallbacks.
- Normalize casing, accents, punctuation, and ß; search up to ten distinct meaningful words.
- Search only SPIEGEL Plus, requesting the ten newest candidates.
- Direct badges require at least three meaningful words with an exact normalized title match, or at least five meaningful words with a token F1 score of 0.94 or greater.
- The best candidate must lead the second by at least 0.12. Ambiguous or generic titles remain manual searches.
- Freshness guard: only candidates published within 7 days of today (plus one day of time-zone slack) can win or tie. An older or undated exact match stays a manual search, so a recurring title cannot link to an old edition. Dates are read from `ERSCHEINUNGSDATUM` as `YYYY-MM-DD`, `DD.MM.YYYY`, or `YYYYMMDD`; if Genios uses another format, direct badges disappear and the background console reports `direct match withheld: undated`. Two editions of a weekly series that both fall inside the window still count as ambiguous.
- Authors and teaser text do not affect the score, and the card's own date is not used yet.
- Equivalent titles share a queued request. Requests run sequentially, with an 800 ms gap, a 15-second timeout, and a one-minute failure cooldown.

## Privacy and limitations

Queries go directly from the browser to Genios, which may log them. The manifest declares this as required data collection of type `websiteContent`, so Firefox shows it when the extension is installed. This extension never reads or stores passwords, cookies, or tokens; Firefox manages eligible session cookies.

Up to 400 cache entries are kept locally: strong matches for six hours and uncertain results for 20 minutes. Keys are hashed normalized headlines; values may include matched article titles, dates, and links. They can reveal reading interests. Clear them using the popup; they do not sync through Firefox or GitHub.

Publisher markup and the internal Genios endpoint can change. Session renewal, reading entitlement detection, Chrome packaging, signing, and permanent installation remain future work. Supported usage limits for automated search have not been established.

## Project layout

```text
extension/       Firefox extension sources
tests/           Deterministic matching, background, and content-script checks (tests/support holds the simulated browser)
scripts/         Syntax/manifest/allowlist validation and ZIP packaging
docs/            Architecture and validation notes
.github/         CI workflow
```

## License

No open-source license has been selected for this prototype.
