# Packaging and signing (Firefox desktop)

How the maintainer turns the repository into a signed `.xpi` that stays installed across Firefox restarts. Only Firefox desktop 140 or later is supported. Signing steps follow Mozilla's Extension Workshop pages for self-distribution; re-check them when you do this, because the add-ons website changes.

Most people can simply load the extension temporarily from source (see the README). This guide is for anyone who wants a permanent install.

## Fixed decisions

| Decision | Value | Why it matters |
| --- | --- | --- |
| Extension ID | `@news-library-lookup` | Keys the local settings and cache of every install. Mozilla checks it is unique at the first signing. After the first signed release, never change it: a new ID is a different extension. |
| Minimum Firefox | 140.0 | Firefox 140 shows data-collection consent at install. Older versions ignore the declaration. |
| Declared data | `websiteContent` (required) | Headline text of paid cards is sent to Genios. Firefox shows this in the install prompt. Keep it in step with the code, `onboarding.html`, the popup note, and the README. |
| Updates | Manual | No `update_url` is set. Installing a newer signed `.xpi` with the same ID upgrades in place and keeps settings. Firefox keeps using the `update_url` of the installed version, so decide on automatic updates before the first public release. |

## Before a release

1. Check your library's terms of use for automated searches, or ask the library. The extension uses the same internal search endpoint as the Genios website, and you are responsible for your use of it.
2. Run the smoke test below with the unsigned build loaded temporarily.

## Steps

1. Bump `version` in both `package.json` and `extension/manifest.json`. Use a higher number than any version you submitted before.
2. Run `npm run check`, `npm test`, and `npm run package`. This writes `dist/news-library-lookup-<version>.zip`.
3. Sign it with a Mozilla account:
   1. Open the Add-ons Developer Hub on addons.mozilla.org and choose **Submit a New Add-on**.
   2. Choose **On your own** (self-distribution, not listed).
   3. Upload the zip. Fix any validator errors and read the warnings, especially security and privacy ones.
   4. Select Desktop Firefox as the platform.
   5. If asked for source code, answer **No**: the extension is plain, unminified JavaScript with no build step, so the uploaded files are the source.
   6. Wait for Mozilla's email saying the version is signed.
   7. Open the add-on under **My Add-ons**, view all versions, open the version you uploaded, and download the signed `.xpi` from the file link.
4. Rename the file to `news-library-lookup-<version>.xpi`. Do not commit it: `.gitignore` excludes `*.xpi` and `*.zip`.
5. Tag the release in git (`git tag v<version>`).

## Installing the signed file

1. Use Firefox 140 or later on a computer.
2. Open the `.xpi` in Firefox (drag it onto a window, or File → Open File) and read the permission prompt. It lists access to VÖBB Genios, Spiegel, and Tagesspiegel and the data collected ("website content").
3. After adding it, the setup page opens. Sign in to VÖBB Genios in the same Firefox profile, then open spiegel.de or tagesspiegel.de.
4. To update, open the newer `.xpi` the same way. An update that adds a site asks for the new site permission again.

## Smoke test

Run on a clean Firefox profile:

- Installing the signed file shows the consent text and the host access. The setup page opens once; restarting Firefox does not open it again.
- After signing in to VÖBB Genios, spiegel.de and tagesspiegel.de each show icons next to their paid markers, and a green icon opens the right Genios record in a new tab.
- The toolbar icon appears and the popup shows its status without errors.
- With a signed-out session, icons turn amber; after signing in, **Retry failed** recovers them without a reload.
- Installing a newer version over an old one keeps the cache and the pause setting.

## Not covered

Listing in a store, other browsers, and mobile are not part of this guide (see [roadmap.md](roadmap.md)).
