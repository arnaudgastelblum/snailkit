[Snailkit](../README.md) · **Showcase scenes**

# Showcase scenes

For contributors. Each tool's card in **Settings → Snailkit** opens with a small looping scene of the tool at work, so people see what it does before they turn it on. This page is the contract for those scenes.

## Where it lives

- `src/modules/<id>/demo.ts` exports `buildDemo(el: HTMLElement, t: (key: string) => string): void`.
- `src/modules/<id>/demo.css` holds its styles (bundled after the module's `styles.css`).
- `src/modules/<id>/index.ts` wires it: `demo: (el, t) => buildDemo(el, t),` (import from `./demo`).
- Strings in `src/modules/<id>/i18n/{en,fr,nl,es}.ts`: `module.pitch` (the card's short line) and any `demo.*` text the scene shows.

## The frame

- `el` is empty, has the class `sk-demo`, a 16:10 ratio, rounded corners, a quiet background and `container-type: size`. Its width goes from about 240 px (phone, narrow settings) to about 720 px (the featured card).
- The scene must fill it and scale with it: an inline SVG with `viewBox="0 0 320 200"` and `width`/`height` 100%, or HTML sized in container units (`cqw`, `cqh`). Never fixed pixel sizes for the layout.
- The card adds `is-playing` to `el` while it is on screen, and removes it when it scrolls away. Every animation runs only under `.sk-demo.is-playing`.

## What a good scene is

- **Realistic**: a miniature of the real interface as it looks in Obsidian (read the module's code, styles and `docs/<id>.md`), simplified: text lines become soft bars, only the few words that matter are written.
- **One moment that sells**: before, the gesture, after. A cursor or a highlight shows the gesture. Then hold the result about 1.5 s and loop. A loop lasts 6 to 9 s.
- **Calm**: soft easing (`var(--sk-ease)`), no flashing, no bouncing for its own sake.
- **Still frame**: without `is-playing`, and with reduced motion, the scene shows its result, complete and readable. Put every `@keyframes` use inside `@media (prefers-reduced-motion: no-preference)`.

## Rules

- Colors only from Obsidian's variables and Snailkit's tokens (`--background-primary`, `--background-secondary`, `--background-modifier-border`, `--text-normal`, `--text-muted`, `--text-faint`, `--interactive-accent`, `--sk-accent`, `--sk-accent-wash`, `--sk-accent-line`, `--sk-surface`...). Tag colors may use fixed hues at low saturation, readable in light and dark themes.
- Classes start with `sk-demo-<id>-`. No `id` attributes (a scene can be on screen twice: in its group and as the featured tool).
- CSS animations only. No timers, no network, no images: everything is drawn.
- Sample content is neutral and in English (`Project X`, `Meeting notes`, `#project/website`). Words of the interface itself come from `demo.*` strings, translated in the four languages.
- `module.pitch`: one line, under 60 characters, a concrete promise in the voice of the product ("Every task in your vault, in one calm list."). Honest: only what the tool really does.
- Tabs, no em dash.

## Preview

With the test instance running (`harness/snailkit-live`, `bash deploy.sh` after each change):

```js
// node cdp.js eval '...'
const host = document.body.createDiv();
host.style.cssText = "position:fixed;inset:40px auto auto 40px;width:480px;z-index:9999;background:var(--background-primary);padding:16px";
const el = host.createDiv({ cls: "sk-demo is-playing" });
const h = app.plugins.plugins.snailkit.host.get("<id>");
h.def.demo(el, (k) => h.translator.t(k));
```

Then `node cdp.js shot x.png`. Remove the element afterwards (`host.remove()`).
