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

Temporary add-ons disappear on Firefox restart. Reload them through about:debugging while developing. If the previous prototype with the same extension ID is already loaded, remove it first or reload it from this checkout so you edit the installed source.

## Badges

| Badge | Meaning |
| --- | --- |
| Über VÖBB lesen | A strong, unambiguous title match in SPIEGEL Plus; opens its Genios record in the current tab |
| In Genios suchen | No sufficiently confident match; opens a manual search in the current tab |
| VÖBB anmelden / erneut prüfen | A session, permission, or network problem interrupted searching |

A direct badge signals a title match, not guaranteed reading rights. Genios checks full-text access when the document opens.

The popup has **Pause checks** and **Clear cache & retry** controls. After signing in again or clearing the cache, reload Spiegel. Background searches create no tabs. An already-running request may finish after pausing.

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

Packaging writes `dist/spiegel-voebb-0.2.0.zip` from an explicit extension-file allowlist. In environments where Python is named `python` rather than `python3`, run `python scripts/package.py` directly.

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
- Dates, authors, and teaser text do not currently affect the score.
- Equivalent titles share a queued request. Requests run sequentially, with an 800 ms gap, a 15-second timeout, and a one-minute failure cooldown.

## Privacy and limitations

Queries go directly from the browser to Genios, which may log them. This extension never reads or stores passwords, cookies, or tokens; Firefox manages eligible session cookies.

Up to 400 cache entries are kept locally: strong matches for six hours and uncertain results for 20 minutes. Keys are hashed normalized headlines; values may include matched article titles, dates, and links. They can reveal reading interests. Clear them using the popup; they do not sync through Firefox or GitHub.

Publisher markup and the internal Genios endpoint can change. Session renewal, reading entitlement detection, Chrome packaging, signing, and permanent installation remain future work. Supported usage limits for automated search have not been established.

## Project layout

```text
extension/       Firefox extension sources
tests/           Deterministic matching and background regression checks
scripts/         Syntax/manifest validation and ZIP packaging
docs/            Architecture and validation notes
.github/         CI workflow
```

## License

No open-source license has been selected for this prototype.
