# Releasing Snailkit

## A new version

1. Bump `version` in `manifest.json` and `package.json` (same number, semver, no `v`).
   If the minimum Obsidian version changes, update `minAppVersion` too.
2. Add the new version to `versions.json`: `"<version>": "<minAppVersion>"`.
3. `npm run build` and `npm test` must pass.
4. Commit, then tag with the exact version and push the tag:
   ```
   git tag 0.1.0
   git push origin 0.1.0
   ```
5. The **Build and release** workflow builds, tests, and creates a **draft** release with
   `main.js`, `manifest.json` and `styles.css`. Review it on GitHub, add release notes, publish.

Obsidian reads `manifest.json` from the default branch and downloads the three files from the
release whose tag equals that version.

## First submission to the Obsidian Community directory

Done once. Requirements: the repository is **public**, has a `README.md`, a `LICENSE`, and a
published (not draft) release whose tag matches `manifest.json`.

1. Sign in at `https://community.obsidian.md` with an Obsidian account.
2. Link the GitHub account that owns the repository, so the directory can verify ownership.
3. Add the plugin from the developer dashboard. The directory reads `manifest.json` at the head
   of the default branch, so make sure it is committed and pushed first.
4. The automated review usually answers within minutes. If it reports problems, fix them,
   publish a new release with a higher version, and check again. Once accepted, the plugin
   appears in **Settings → Community plugins → Browse** within 24 hours.

Every later release is reviewed automatically too before users get it.
See `https://docs.obsidian.md/plugins/releasing/submit-plugin`.

Review points worth checking before submitting (from Obsidian's plugin guidelines): no default
hotkeys, no `innerHTML` with user content, no global CSS that changes Obsidian's own UI, no
network access without saying so in the README, desktop-only APIs only behind `Platform`
checks, `isDesktopOnly` false only if the plugin works on mobile, no "Obsidian" in the plugin
name, and the description under 250 characters ending with a period.
