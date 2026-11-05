# Validation history

The diagnostic extension was verified to perform fresh searches from a Firefox background context and open returned articles through VÖBB. The homepage prototype was then tried in a real session with good behavior, without incorrect matches, omissions, or slow badges noticed at that point. This is informal acceptance evidence, not a measured accuracy study.

Automated regression checks cover title normalization, exact matches, ambiguity, short titles, wrong sources, unsafe document IDs, queue deduplication, cache reuse, sender/frame validation, non-JSON response handling, cooldown, missing permissions, and pause behavior. They use simulated responses and do not require credentials.

A one-off offline browser check against downloaded Spiegel homepage HTML found 151 article cards and attached 47 paid-card badges. It checked same-tab links, absence of nested anchors, dynamic insertion, and pause/resume. That downloaded third-party HTML and the machine-specific browser harness are intentionally not committed. A portable fixture-based DOM suite remains future work.

CI verifies syntax, manifest resources, version alignment, deterministic regressions, and packaging. It does not verify authenticated browser operation, live publisher compatibility, matching accuracy, browser-store eligibility, or Genios licensing/usage permission.
