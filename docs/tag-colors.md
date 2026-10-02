[Snailkit](../README.md) · **Tag colors**

# Tag colors

Recognize a tag's family at a glance, with compact capsules and colors that stay put. Your notes never change.

## What it does

- Shows nested tags as a family capsule joined to a colored body: `[ PROJECT ][ website › design ]`.
- Colors tags in Live Preview and Reading view, plus tag properties and the Tags pane.
- Assigns colors automatically, most used families first. Each child gets a distinct color while its family's 14 slots are available.
- Lets you choose a tag or family color from 14 swatches or a color picker.
- Follows light and dark themes, with readable OKLCH colors and unchanged line height.

## How to use it

1. Enable **Tag colors** in **Settings → Snailkit**.
2. Open a note containing tags such as `#project/website/design`, `#reading`, and `#home/garden`.
3. In Live Preview, move the cursor away from a tag to see its capsule. Touch the tag with the cursor or selection to edit its original, tinted text.
4. Right-click a capsule or a Reading view tag. Choose **Change tag color…** for its body, or **Change family color…** for every capsule in that family.
5. Choose a swatch, use the color picker, or choose **Reset to automatic**. Click a capsule to search for that tag.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Uppercase family name | On | Shows the family name in capitals. Off keeps the spelling used in the note. |
| Color properties and tag pane | On | Recolors Obsidian's tag property pills and tag names in the Tags pane. |
| Most used tags | Top 20 | Shows tag capsules and occurrence counts; click a capsule to choose its color. |
| Hand-picked colors | None | Lists your chosen colors, with buttons to change or reset each one. |
| Reassign automatic colors | On request | Rebuilds the automatic registry from current usage after confirmation. Keeps hand-picked colors. Also available in the command palette. |

Settings and chosen colors apply immediately. You can choose colors while the module is off; they apply to notes when you enable it.

## Exact behavior

The capsule contains the first tag level without `#`. Its joined body contains the remaining levels, separated by `›`, with faded intermediate levels and a bold final level. A simple tag has only the family capsule. All parts remain inline and inherit line height; their sizes follow headings. Display capitalization and chevrons never replace the text stored in notes.

Live Preview uses Obsidian's parsed hashtag nodes, so ordinary text, inline code, and fenced code are not converted. Any selection touching the tag, including either boundary, reveals its original text. Source mode remains uncolored. Reading view keeps the original tag link and its native click behavior. Properties keep their original pill text; the Tags pane keeps its original structure. Canvas, search results, and link hover previews are outside this module's rendering scope.

Tag keys ignore case and a leading `#`; Unicode names are supported. `#Project/Website` and `#project/website` share colors. New tags are assigned after metadata updates settle for one second; registry saves are debounced. Before indexing finishes, an unknown tag can temporarily use its hash-derived color. Once registered, it keeps its slot even if frequencies change or it disappears from the vault.

Automatic assignment uses FNV-1a modulo 14, with collisions probed by adding 5 modulo 14. Roots are processed first, in descending frequency. Implicit ancestors inherit their most frequent descendant's count for ordering. Children avoid every already assigned slot in their family, including ancestors and cousins. When all slots are occupied, the original candidate is reused. Existing assignments never move automatically. Reassigning runs this deterministic process again, so it can produce the same colors when usage has not changed.

A root override changes every capsule in its family. A nested override changes only that full tag's body. The color picker stores only OKLCH hue, keeping the same lightness and chroma rules as the palette for legibility. Hand-picked colors may deliberately coincide. Resetting an override restores the saved automatic slot. Reassigning preserves all overrides.

The palette uses `slot × 360 / 14 + 18` degrees. Light theme body background/text use lightness and chroma `(0.955, 0.032)` / `(0.43, 0.11)`; capsule background/text use `(0.89, 0.065)` / `(0.36, 0.12)`. Dark theme uses `(0.29, 0.045)` / `(0.85, 0.085)` for the body and `(0.38, 0.075)` / `(0.90, 0.07)` for the capsule. Chroma is reduced to fit sRGB; foreground lightness is adjusted if needed for 4.5:1 contrast against its own background. The muted intermediate labels retain the source design's opacity.

Clicking a Live Preview capsule opens `tag:#<tag>` in Obsidian's Search core plugin. Enable that core plugin to use search. Capsules also support Enter and Space, and taps on mobile. Reading view uses Obsidian's link handling.

Turning the module off removes its editor extension, dynamic palette, observers, timers, and classes on existing elements. Reading links regain their original child nodes. Open module dialogs close. Existing note surfaces should clear without a reload; Obsidian refreshes its editor and Markdown processors during disable. If a third-party renderer caches a detached copy of a capsule, reopen that view to rerender it. No note is written by this module.

The registry is saved inside the module settings as `slots` and `overrides` arrays of `[tagKey, number]` entries. Slots are integers from 0 to 13; overrides are hues from 0 inclusive to 360 exclusive. Migration accepts the source's object-shaped registries and validates either format. There is no automatic import from another plugin's data file.

## For developers

The module publishes this service while enabled, defined in [`api.ts`](../src/modules/tag-colors/api.ts):

```ts
interface TagColorsAPI {
	readonly version: 1;
	classes(tag: string): string;
}
```

Use `ctx.service<TagColorsAPI>("tag-colors")` inside a module, or `app.plugins.plugins.snailkit.api.service("tag-colors")` from a companion plugin. Pass a tag without `#`, such as `project/website/design`. The returned space-separated classes set `--sk-tag-r-bg`, `--sk-tag-r-fg`, `--sk-tag-l-bg`, and `--sk-tag-l-fg` on any element for the current theme. The first pair represents its family; the second represents its own body. The service supplies colors only, not capsule markup.

Re-read the service and replace previously applied classes when `snailkit:services-changed` fires, or use `ctx.onServicesChange`. This event also fires when colors change. Do not retain the service after disable. Its dynamic CSS disappears when disabled; remove your saved classes and provide your own normal appearance when the service is absent. Theme changes select the matching CSS automatically.
