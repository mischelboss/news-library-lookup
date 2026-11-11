# Spiegel via VÖBB

A Firefox extension prototype that checks paid articles on the Spiegel and Tagesspiegel homepages and adds links to corresponding records in VÖBB's Genios service.

**Status:** authenticated background searches, article links, and the homepage prototype have been tried successfully in a real Firefox session. This is an unsigned prototype using an internal website endpoint, not an official VÖBB, Genios, or Spiegel product.

## Load it in Firefox

1. Clone this repository, or download and extract its source ZIP.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…** and select `extension/manifest.json`.
4. Allow access to Spiegel, Tagesspiegel, and VÖBB Genios when Firefox requests it. If needed, review the extension's Permissions tab in `about:addons`.
5. Sign in normally at https://bib-voebb.genios.de/ in the same Firefox profile. A private window or isolated container might not share its session with extension background requests.
6. Open or reload https://www.spiegel.de/ or https://www.tagesspiegel.de/.

Temporary add-ons disappear on Firefox restart. Reload them through about:debugging while developing. Version 0.3.0 changed the extension ID to `@spiegel-voebb`; remove any older temporary prototype first so you edit the source you actually load. Firefox 140 or later is required.

## Icons

Each paid headline gets a small round icon right after the site's own paid marker (the "+" on Spiegel, the small red "T" on Tagesspiegel). It never takes extra space under the article. Hover for details; every icon opens Genios in a **new tab**, so the Spiegel page stays where it is.

| Icon | Meaning |
| --- | --- |
| Grey magnifier | The search is still queued or running |
| Green check ("Über VÖBB lesen") | A strong, unambiguous title match in the publisher's Genios sources; opens its Genios record. If the article is older than a week, the tooltip says so |
| Blue magnifier ("In Genios suchen") | No sufficiently confident match; opens a manual search |
| Amber "!" ("VÖBB anmelden / erneut prüfen") | A session, permission, or network problem interrupted searching; opens Genios so you can sign in |

A green icon signals a title match, not guaranteed reading rights. Genios checks full-text access when the document opens.

The popup has **Pause checks**, **Retry failed**, and **Clear cache** controls. After signing in again, choose **Retry failed** to re-check failed badges without reloading; successful badges are not queried again. After clearing the cache, reload Spiegel. Background searches create no tabs. An already-running request may finish after pausing.

When a search finds no direct match, the background console says why with numbers only, never titles: `tagesspiegel: no direct match (results 10, from expected sources 3, best score 0.62)`. Zero results means the article is probably not in Genios (yet) or the query is too narrow; results but none from expected sources means the source names differ (the console then lists the names Genios returned); a low best score means the titles differ.

The popup status names the last failure category (for example `network`, `HTTP 503`, `timeout`, `content-type`, `json`, or `shape`). The background console logs the same category only, never queries, URLs, headers, cookies, or response bodies.

## Install a signed package

You do not need the repository to use a signed package. The maintainer provides a signed `spiegel-voebb-<version>.xpi` (see docs/releasing.md for how it is made). The extension is Firefox desktop only for now.

1. Use Firefox 140 or later on a computer.
2. Open the `.xpi` in Firefox (drag it onto a window, or File → Open File) and read the permission prompt. It lists access to VÖBB Genios, Spiegel, and Tagesspiegel and the data collected ("website content": the headlines sent to Genios).
3. After adding it, the setup page opens. Sign in to https://bib-voebb.genios.de/ in the same Firefox profile with your own VÖBB account, then open https://www.spiegel.de/ or https://www.tagesspiegel.de/.
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

After editing, click **Reload** for the extension in about:debugging, then reload the news page. Use **Inspect → Console** for background diagnostics. Do not export or commit authentication headers or cookies.

## Matching and requests

- Each publisher is one adapter in `extension/publishers.js`: its exact origin, the listing paths that are processed, how a paid card is recognized, how the title is read, and which Genios sources hold its articles. Only homepages are processed today (`/` and `/index.html` on Spiegel, `/` on Tagesspiegel).
- Spiegel: paid cards carry explicit `spon` / `plus-paid` flags; the title is the card's accessible label.
- Spiegel links to articles as `slug-a-<id>` or just `a-<id>`; placeholder links (`__proto_url__`), links to other sites, and cards paid under another flag domain (for example effilee) are skipped.
- Tagesspiegel: paid cards carry a small icon followed by the hidden text "Tagesspiegel Plus" inside the headline link; the heading level varies (h2 on lead teasers, h3 on most others), so the heading is taken from that link. The title is the headline as shown, `kicker: headline`. Invisible soft hyphens inside long words are removed.
- Normalize casing, accents, punctuation, and ß; search up to ten distinct meaningful words.
- Search only the publisher's Genios sources, requesting the ten newest candidates: `SPIEGEL Plus` for Spiegel; `tagesspiegel.de`, `Der Tagesspiegel`, and `Tagesspiegel CHECKPOINT` for Tagesspiegel (repeated `source` parameters in one request). Source names in responses are compared without regard to case or spacing.
- Kicker handling (Tagesspiegel): Genios may store the title with or without the kicker, so a candidate is scored against both forms, and the search query uses only the headline words, which appear in either form.
- The same article often exists in several sources (for example print and web). Records with the same normalized title from different sources count as one article, and the source listed first wins. Several records from the same source still count as ambiguous.
- Direct matches require at least three meaningful words with an exact normalized title match, or at least five meaningful words with a token F1 score of 0.94 or greater.
- The best candidate must lead the second by at least 0.12. Ambiguous or generic titles remain manual searches.
- Freshness guard, two passes over the same results. First, only candidates published within 7 days of today (plus one day of time-zone slack) can win or tie, so a recurring title cannot link to an old edition. If that finds nothing, the same results are ranked again with a window of 365 days; here only an exact title counts, a tie stays ambiguous, and the icon's tooltip says the article is older. This catches long-lived pieces such as Bestseller articles without sending a second request to Genios. Older or undated matches beyond that stay manual searches.
- Dates are read from `ERSCHEINUNGSDATUM` as `YYYY-MM-DD`, `DD.MM.YYYY`, or `YYYYMMDD`. If Genios uses another format, direct matches disappear and the background console reports `direct match withheld: undated`. Two editions of a weekly series that both fall inside the first window still count as ambiguous.
- Authors and teaser text do not affect the score, and the card's own date is not used yet.
- Equivalent titles on the same site share a queued request. Requests run sequentially across all sites, with an 800 ms gap and a 15-second timeout. A failure starts a one-minute cooldown for that publisher only, so a problem with one site's search does not silence the other.

## Privacy and limitations

Queries go directly from the browser to Genios, which may log them. The manifest declares this as required data collection of type `websiteContent`, so Firefox shows it when the extension is installed. This extension never reads or stores passwords, cookies, or tokens; Firefox manages eligible session cookies.

Up to 400 cache entries are kept locally: strong matches for six hours and uncertain results for 20 minutes. Keys are hashes of the publisher and the normalized headline; values may include matched article titles, dates, and links. They can reveal reading interests. Clear them using the popup; they do not sync through Firefox or GitHub.

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
