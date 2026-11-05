# Notes for coding agents

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/architecture.md](docs/architecture.md) before changing behavior. The design rules in CONTRIBUTING.md apply to every change.

- Run `npm run check`, `npm test`, and `npm run package` after substantive changes.
- Use simulated responses and hand-written fixtures in tests. Do not make live or authenticated calls.
- Do not commit credentials, cookies, tokens, browser profiles, HAR files, saved publisher pages, or article text.
- Keep privacy statements (manifest, onboarding page, popup, README) in step with the code.
