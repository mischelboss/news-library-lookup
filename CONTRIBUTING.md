# Contributing

Thanks for your interest. This is a small hobby project, so please open an issue to discuss larger changes before you start. Bug reports are welcome, especially when a publisher changes its markup. Please do not include account details, cookies, or article text in issues.

## Setup

Requirements: Node.js 22 or later and Python 3. There is nothing to install.

```sh
npm run check
npm test
npm run package
```

Run all three after substantive changes. CI runs them too. Keep the `version` in `package.json` and `extension/manifest.json` aligned.

## Design rules

These rules protect users' accounts and privacy. Changes that weaken them will not be merged.

- **Plain JavaScript only.** The extension lives in `extension/` and uses WebExtension APIs, local assets, and no bundler, transpiler, or runtime dependency.
- **Narrow connection policy.** The extension talks to the Genios host and nothing else. Keep the sender and frame validation, the sequential request queue, the cache limits, and the failure cooldown.
- **Content scripts send only a title and a publisher id.** The background script looks up hosts, paths, and Genios source names in its own adapter registry (`extension/publishers.js`) and never takes URLs, hosts, or source names from messages. Cache keys include the publisher.
- **Render remote metadata with `textContent`.** Never insert fetched HTML or executable code.
- **Be honest about matches.** A title match is not proof that a user may read the full text. Keep ambiguous matches as manual search links.
- **Keep privacy statements accurate.** Whenever what is sent or stored changes, update `data_collection_permissions` in the manifest, the onboarding page, the popup note, and the privacy section of the README.
- **Never log sensitive data.** Logs may contain failure categories and counts, never queries, URLs, headers, cookies, or response bodies.
- **Keep the extension ID stable.** `@news-library-lookup` keys users' local settings. Do not change it after the first signed release.

## Tests and fixtures

- Tests are deterministic. They use simulated browser objects and simulated network responses. Do not make live or authenticated calls to Genios or to publisher sites in tests or CI.
- Write test fixtures by hand. Do not commit saved copies of publisher pages, full article text, HAR files, cookies, tokens, or browser profiles. `.gitignore` already excludes the usual suspects.
- Derive publisher markup and Genios source names from your own observation of the sites, and describe them in your own words in the code and docs.

## Adding a publisher or a library

Each publisher is one adapter in `extension/publishers.js`: its origin, allowed listing paths, paid-card detection, title reading, and Genios source names. A new adapter also needs its origin in the manifest's content-script matches (`npm run check` verifies they agree) and tests with hand-written markup. Supporting another library or page type is a bigger change; please open an issue first.

## Pull requests

Keep changes focused, explain the reason for them, and update the docs when behavior changes. Commit messages in the style `feat: ...`, `fix: ...`, `docs: ...`, `test: ...` are appreciated.
