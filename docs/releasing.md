# Packaging and signing (Firefox desktop)

How to turn the repository into a signed `.xpi` that can be installed and kept across Firefox restarts. Only Firefox desktop 140 or later is supported (see docs/roadmap.md). Signing steps follow Mozilla's Extension Workshop pages for self-distribution; re-check them when you do this, because the AMO website changes.

## Decisions already made (and why they are hard to undo)

| Decision | Value | Why it matters |
| --- | --- | --- |
| Extension ID | `@spiegel-voebb` | Keys the local settings and cache of every install. AMO checks it is unique when you first sign. After the first signed release, never change it: a new ID is a different extension. |
| Minimum Firefox | 140.0 | Firefox 140 shows data-collection consent at install. Older versions ignore the declaration. |
| Declared data | `websiteContent` (required) | Headline text of paid Spiegel and Tagesspiegel cards is sent to Genios. Firefox shows this in the install prompt. Keep it in step with the code, `onboarding.html`, and the README. |
| Updates | Manual: send the new `.xpi` | No `update_url` is set, so there is no automatic update channel. |

About updates: Firefox keeps using the `update_url` of the version that is installed. If you ever want automatic self-hosted updates, the version users first install must already contain it; adding it later means each user installs by hand once more. If you publish on AMO later, a listed add-on updates itself. Until then, installing a newer signed `.xpi` with the same ID should upgrade in place and keep the user's settings.

## Before the first release

1. **Terms of use (your task).** Check the VÖBB and Genios terms for automated searches, or ask VÖBB. A search for Genios's terms returned nothing useful, so this is a manual look (footer of genios.de, the VÖBB website, or the library). Do not share the extension until you are comfortable with the answer.
2. **Describe what it does.** Point users to the README and the onboarding page text. Each user signs in with their own library account; nothing is shared.
3. **Check the real browser once** (see "Smoke test" below) with the unsigned build loaded temporarily.

## Release steps

1. Bump `version` in both `package.json` and `extension/manifest.json`. Use a higher number than any version you submitted before.
2. `npm run check`, `npm test`, `npm run package`. This writes `dist/spiegel-voebb-<version>.zip`.
3. Sign it (Mozilla Account required):
   1. Open the Add-ons Developer Hub on addons.mozilla.org and choose **Submit a New Add-on** (the first time: **Submit Your First Add-on**).
   2. Choose **On your own** (self-distribution, not listed on AMO).
   3. Upload the zip. Fix any validator errors; read warnings, especially security or privacy ones.
   4. Select Desktop Firefox as the platform.
   5. When asked about source code, answer **No**. The extension is plain, unminified JavaScript with no build step, so the uploaded files are the source.
   6. Wait for Mozilla's email saying the version is signed. The time is not documented.
   7. Open the add-on under **My Add-ons**, view all versions, open the version you uploaded, then use "Save Link As…" on the file link to download the signed `.xpi`.
4. Rename the file to `spiegel-voebb-<version>.xpi` and distribute it directly. Do not commit it: `.gitignore` excludes `*.xpi` and `*.zip`.
5. Tag the release in git (`git tag v<version>`) so you can find what was shipped.

## Installing the signed file (also in the README)

1. Use Firefox 140 or later on a computer.
2. Open the `.xpi` file in Firefox (drag it onto a Firefox window, or File → Open File).
3. Read the permission prompt. It lists access to VÖBB Genios, Spiegel, and Tagesspiegel and the data the extension collects ("website content"). Add the extension.
4. The setup page opens. Sign in to VÖBB Genios in the same Firefox profile, then open spiegel.de or tagesspiegel.de.
5. To update: open the new `.xpi` the same way. An update that adds a site (0.4.0 added tagesspiegel.de) asks for the new site permission again; users should accept it.

## Smoke test (do this before sending it out)

Run on a clean Firefox profile, ideally on a second computer or with a new profile:

- Installing the signed file shows the consent text and the host access. The setup page opens once; restarting Firefox does not open it again.
- Both news sites work: after signing in, spiegel.de and tagesspiegel.de each show icons next to their paid markers, and a green Tagesspiegel icon opens the right Genios record.
- The toolbar icon appears. The popup shows status without errors.
- After signing in to VÖBB Genios, the Spiegel homepage shows an icon after each paid +. A green one opens the right article's Genios record in a new tab.
- With a signed-out session, icons turn amber ("VÖBB anmelden / erneut prüfen"); after signing in, **Retry failed** recovers them without a reload.
- Installing a newer version over an old one keeps the cache and the pause setting.

If anything here fails, fix it before sending the file; a bad first release is hard to recall.

## Not part of this guide

Listing on AMO, Chrome, Firefox Android, Safari, and a public license are deferred (see docs/roadmap.md, Phases 5–7).
