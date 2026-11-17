# News Library Lookup

A Firefox extension that helps you read paid newspaper articles through your public library. On the Spiegel and Tagesspiegel homepages it adds a small icon next to each paid article. The icon opens the matching record in your library's Genios press database, where your library card decides whether you can read it.

It is built for [VÖBB](https://www.voebb.de/) (the Berlin public libraries) and its Genios service. It is a hobby project.

> **Unofficial.** This project is independent. It is not affiliated with, endorsed by, or supported by VÖBB, Genios, Der Spiegel, or Der Tagesspiegel. All names and trademarks belong to their owners.

*Kurzfassung (Deutsch):* Firefox-Erweiterung, die bezahlte Artikel auf spiegel.de und tagesspiegel.de mit dem passenden Treffer in der VÖBB-Genios-Datenbank verknüpft. Du meldest dich selbst mit deinem eigenen Bibliotheksausweis an; die Erweiterung umgeht keine Bezahlschranke und speichert keine Zugangsdaten. Inoffizielles Hobbyprojekt, Firefox (Desktop) ab Version 140.

## What it does

- Finds paid cards on the homepages of Spiegel and Tagesspiegel.
- Searches the publisher's own sources in VÖBB Genios for the headline, using your signed-in session.
- Shows one of four icons next to the site's paid marker and opens Genios in a new tab when you click it.
- Stays careful: only a strong, unambiguous title match becomes a direct link. Everything else is a manual search link.

| Icon | Meaning |
| --- | --- |
| Grey magnifier | The search is still queued or running |
| Green check | A strong title match in the publisher's Genios sources; opens that record. If the article is older than a week, the tooltip says so |
| Blue magnifier | No sufficiently confident match; opens a manual Genios search |
| Amber "!" | A session, permission, or network problem interrupted searching; opens Genios so you can sign in |

A green icon means the titles match. It is not a guarantee that you may read the full text. Genios checks that when the record opens.

## What it does not do

- It does not bypass any paywall. It only links to records you can open with your own library account.
- It does not read, store, or send your password, cookies, or tokens. Firefox handles the session cookies.
- It does not download or store article text.

## Install

The extension is not listed in a browser store. You can run it from source in Firefox 140 or later on a desktop computer:

1. Clone this repository or download and extract its source ZIP.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…** and select `extension/manifest.json`.
4. Allow access to Spiegel, Tagesspiegel, and VÖBB Genios when Firefox asks. You can review this later in the extension's Permissions tab in `about:addons`.
5. Sign in at <https://bib-voebb.genios.de/> in the same Firefox profile, with your own VÖBB account. A private window or an isolated container might not share its session with the extension.
6. Open or reload <https://www.spiegel.de/> or <https://www.tagesspiegel.de/>.

Temporary add-ons disappear when Firefox restarts. To keep the extension permanently you need a signed package; see [docs/releasing.md](docs/releasing.md).

The toolbar popup has **Pause checks**, **Retry failed**, and **Clear cache**. After signing in again, **Retry failed** re-checks failed icons without a page reload.

## Responsible use

- The extension uses the same internal search endpoint that the Genios website uses in your browser. It is not an official or documented API, so it can change or stop working without notice.
- Searches run one at a time with a pause between them, and stop for a minute after a failure. Please do not remove these limits.
- Check that your library's terms of use allow this kind of automated search before you use it. You are responsible for how you use your own library account.

## Privacy

- For each paid headline on a supported homepage, the extension sends the words of that headline to VÖBB Genios from your browser. Genios may log these searches. Nothing is sent to the developer or to anyone else.
- Firefox shows this as the required data type "website content" when you install the extension.
- Up to 400 results are cached locally: strong matches for six hours, uncertain ones for 20 minutes. Keys are hashes of the publisher and the normalized headline. Values can include matched article titles, dates, and links, which can reveal what you read. The cache never syncs and can be cleared from the popup.

## How matching works

- Each publisher is one adapter in `extension/publishers.js`: its exact origin, the listing paths that are processed, how a paid card is recognized, how the title is read, and which Genios sources hold its articles. Only homepages are processed today.
- Titles are normalized (case, accents, punctuation, ß) and up to ten distinct meaningful words are searched, restricted to the publisher's Genios sources.
- A direct match needs either an exact normalized title (at least three meaningful words) or a token F1 score of at least 0.94 (at least five words). The best candidate must also lead the second by at least 0.12.
- Freshness guard: a candidate must be at most 7 days old to win. If nothing qualifies, the same results are ranked again with a 365-day window where only an exact title counts, so long-lived articles can still be found. The icon's tooltip says when the article is older.
- The same article often exists in several Genios sources (for example print and web). Equal titles from different sources count as one article.
- Authors and teaser text do not affect the score.

More detail is in [docs/architecture.md](docs/architecture.md).

## Development

Requirements: Node.js 22 or later for checks and tests, and Python 3 for packaging. There are no npm dependencies and no build step.

```sh
npm run check     # manifest, permissions, packaging allowlist, version alignment, syntax
npm test          # deterministic tests with simulated browser and network
npm run package   # writes dist/news-library-lookup-<version>.zip
```

Tests use hand-written fixtures and simulated responses. They never call Genios or any publisher site. CI runs the same three commands. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [docs/testing.md](docs/testing.md) for what is and is not verified.

After editing the source, click **Reload** for the extension in `about:debugging` and reload the news page. **Inspect → Console** shows the background diagnostics. They contain failure categories and counts only, never queries, URLs, headers, cookies, or response bodies.

## Project layout

```text
extension/   Firefox extension sources (plain JavaScript, no dependencies)
tests/       Matching, background, content-script, and page tests (tests/support holds the simulated browser)
scripts/     Validation (check.cjs) and ZIP packaging (package.py)
docs/        Architecture, testing notes, release guide, roadmap
.github/     CI workflow
```

## Status and limits

This is a working prototype. Publisher markup and the Genios endpoint can change at any time. Direct matches are tested against hand-written fixtures; behavior against the live services depends on a signed-in library account and is checked by hand. Firefox desktop is the only supported browser. Other browsers and more publishers are listed in [docs/roadmap.md](docs/roadmap.md).

## License

Licensed under the [GNU General Public License v3.0](LICENSE). Copyright (c) 2026 mischelboss.
