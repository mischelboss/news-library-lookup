# Architecture and current boundaries

`spiegel.js` runs in the publisher page, detects paid cards, adds isolated badge UI, and asks the background process for matches. It sends only a title, not an arbitrary URL. A mutation observer handles newly inserted cards.

`background.js` validates the sending origin and top-level frame, deduplicates titles, queues searches, checks host permission, handles session/network failure, and stores bounded local cache entries. Only the extension's own pages may toggle or reset the service.

`matching.js` is a pure matching module loaded before the background script. It normalizes titles and ranks source-validated documents. Tests load the same file directly through Node.

`popup.*` provides pause/reset controls, basic queue status, and an explicit VÖBB sign-in link.

## Website interface

```text
GET https://bib-voebb.genios.de/api/searchResult/Alle
  requestText=<normalized query>
  source=SPIEGEL Plus
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
