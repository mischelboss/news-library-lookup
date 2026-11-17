# Testing and verification

This page says what the automated checks cover and what has to be verified by hand. The extension needs a signed-in library account to run for real, so CI never exercises the live services.

## Automated checks

`npm test` runs deterministic tests with a small purpose-built fake DOM and simulated browser and network objects:

- **Matching:** title normalization, exact matches, ambiguity, short titles, wrong sources, unsafe document ids, kicker handling, print and web duplicates, source-name normalization, and the freshness guard (including recurring titles and the 365-day second pass).
- **Background:** queue deduplication, cache reuse, the 400-entry cap and TTL expiry, sender and frame validation, each failure category with sanitized logging, cooldown per publisher, retry, reset during an in-flight request, request timeout, missing permissions, and pause behavior.
- **Content script:** paid-card detection on hand-written markup shaped like the observed pages, icon placement, the icon states, new-tab links with `noopener`, link-origin rejection, text-only rendering of remote metadata, late-inserted cards, and retry of failed icons only.
- **Publishers:** the registry, exact-origin and listed-path matching (including lookalike hosts), that a message cannot choose sources, hosts, or paths, and that sender and publisher must agree.
- **Pages:** every element id a page script uses exists in its HTML, extension pages load only local scripts with no inline script, the onboarding page opens once on a fresh install, and the permission button requests only the Genios origin.

`npm run check` additionally validates the manifest and permissions, that content-script matches equal the publisher registry's origins, that package files and files referenced by the manifest or popup are on the packaging allowlist, version alignment, the extension ID and data-collection declaration, and JavaScript syntax.

Mutation spot checks (disabling the freshness filter, the extended pass, the retry listener, the cache cap, the cooldown, the origin check, the frame check, and similar one at a time) were each caught by the suite.

CI runs `check`, `test`, and `package`. It does not verify authenticated browser operation, compatibility with the live publisher sites, matching accuracy on real data, or any library's terms of use.

## Lesson from real pages

Fixtures written by hand can hide coverage gaps. Running the adapters once over saved copies of both homepages (parsed into the fake DOM, not committed) showed that most paid Tagesspiegel cards use an `h3` heading rather than `h2`, and that some Spiegel articles are linked without a slug. Both were fixed. Cards that point to other publishers, or are paid under another flag domain, are skipped on purpose. Check fixtures against real pages when a publisher changes its markup.

## Verified by hand

Search, article links, and the homepage flow were tried in a real Firefox session with a VÖBB account and behaved as intended. This is informal evidence, not a measured accuracy study.

## Not yet verified

Checks that need a signed-in session and a real browser:

- Tagesspiegel behavior against real Genios data: repeated `source=` parameters on the JSON endpoint, the exact `QUELLENNAME` values, and how titles are stored.
- The icon's position and click behavior on live pages.
- That Genios returns `ERSCHEINUNGSDATUM` in a format the freshness guard reads.
- That `/searchResult/Alle` opens correctly as the manual search link.
- The retry control and the signed install flow in a real browser.

If a check fails, the background console shows a category and counts (see the README) that help to diagnose it without exposing queries or article data.
