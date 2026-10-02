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

## First submission to the community plugins list

Done once. Requirements: the repository is **public**, has a `README.md`, a `LICENSE`, and a
published release (see above) whose tag matches `manifest.json`.

1. Fork `https://github.com/obsidianmd/obsidian-releases`.
2. Add this entry at the end of `community-plugins.json`:
   ```json
   {
   	"id": "snailkit",
   	"name": "Snailkit",
   	"author": "Arnaud Gastelblum",
   	"description": "A kit of small, calm tools for your notes. Turn on only the ones you want.",
   	"repo": "arnaudgastelblum/snailkit"
   }
   ```
   `id`, `name`, `author` and `description` must match `manifest.json` exactly.
3. Open a pull request titled `Add plugin: Snailkit` and fill in the checklist of the pull
   request template.
4. An automated check runs first, then a human review. Answer review comments by pushing fixes
   and a new release; the pull request is merged when the review passes, and the plugin appears
   in **Settings → Community plugins → Browse**.

Review points worth checking before submitting (from Obsidian's plugin guidelines): no default
hotkeys, no `innerHTML` with user content, no global CSS that changes Obsidian's own UI, no
network access without saying so in the README, desktop-only APIs only behind `Platform`
checks, `isDesktopOnly` false only if the plugin works on mobile, no "Obsidian" in the plugin
name, and the description under 250 characters ending with a period.
