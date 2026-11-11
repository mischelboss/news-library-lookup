# Architecture and current boundaries

`publishers.js` is the registry of publisher adapters, loaded by both the content script and the background. Each adapter holds the exact origin, the listing paths, the Genios sources, how to recognize and read a paid card, and how to vary a title. It is the single source of truth: `npm run check` requires the manifest's content-script matches to equal the registry's origins.

`content.js` runs on every supported site, picks the adapter for the current URL (exact origin and a listed path, top frame only), detects paid cards through it, adds an isolated icon (a shadow-root host placed right after the site's paid marker, inside the headline link, whose own link opens Genios in a new tab), and asks the background process for matches. It sends only `{type, publisher id, title}`, never a URL, source, or path. A mutation observer handles newly inserted cards.

`background.js` resolves the publisher from the sender's real URL (exact origin, listed path, top frame) and requires the message to name that same publisher, so a message cannot choose sources, hosts, or paths. It deduplicates titles per publisher, queues searches, checks host permission, handles session/network failure, and stores bounded local cache entries. Only the extension's own pages may toggle or reset the service.

`matching.js` is a pure matching module loaded before the background script. It normalizes titles and ranks documents, accepting only the publisher's sources (compared without case or spacing), scoring each candidate against every title variant, and treating same-title records from different sources as one article. Ranking runs in two passes over the same response: a 7-day freshness window, then a 365-day window that accepts only exact titles. The search request itself carries no date constraint. Tests load the same file directly through Node.

`popup.*` provides pause, retry, and cache-clear controls, basic queue status, and an explicit VÖBB sign-in link.

Failures are classified (`network`, `timeout`, `http`, `content-type`, `json`, `shape`, `internal`). The category appears in the popup status and the background console; nothing else about the request or response is logged. A search that finds no direct match also logs counts (results returned, results from expected sources, best score) and no titles, so a miss can be diagnosed from the background console. Any failure still starts a one-minute cooldown, kept per publisher so a problem with one site's search (for example a rejected parameter) cannot silence the other. The popup's retry control clears the cooldown and writes a `retryToken` to `storage.local`; open news pages listen for that change and re-check only icons that failed. The retry control clears every publisher's cooldown.

The JSON request and the manual search link are built from one parameter set in `background.js`; they differ only in path (`/api/searchResult/Alle` versus `/searchResult/Alle`).

## Website interface

```text
GET https://bib-voebb.genios.de/api/searchResult/Alle
  requestText=<normalized query>
  source=<one per Genios source of the publisher, e.g. SPIEGEL Plus>
  size=10
  sort=BY_DATE
  order=desc
  resultListType=DEFAULT
```

Responses contain documents with documentId and fields such as ARTIKELTITEL, TL-TITEL, QUELLENNAME, and ERSCHEINUNGSDATUM. A selected document becomes `https://bib-voebb.genios.de/document/{documentId}`.

The fetch uses browser-managed credentials, rejects redirects, and requires JSON. It does not use the separately documented external Genios API or request full article text. An expired session can appear as a redirect/network error; the prototype currently groups these failures under one sign-in/retry message.

## Future work

- Gather concrete missed or ambiguous match examples before adjusting thresholds.
- Test session expiry and login recovery without reopening search tabs.
- Improve date and entitlement handling with verified response fields.
- Replace the in-memory queue with resumable jobs if browser lifecycle testing shows lost requests.
- Add a distributable, licensed browser package and explicit service-usage guidance before wider release.
- Separate publisher and library adapters further when a second integration is authorized.
