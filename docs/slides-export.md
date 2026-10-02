[Snailkit](../README.md) · **Slides to PowerPoint**

# Slides to PowerPoint

Turn the frames of an Excalidraw drawing into a PowerPoint presentation, with the drawing's own look.

## What it does

Each included frame becomes one picture on one slide. This module needs the **Excalidraw community plugin**, enabled, with its rendering API from version **2.27.0 or newer**. It uses the frame order of Excalidraw's **Slideshow script**, including the order and exclusions saved by its side panel.

Excalidraw renders the pictures. Snailkit clips them to their frames, centers them on the slides, and fills any bands with the canvas color. A progress notice follows the export slide by slide.

## How to use it

1. Install and enable Excalidraw, then turn on **Slides to PowerPoint** in **Settings → Snailkit**.
2. Open a drawing in an Excalidraw view. Draw a frame around each slide. Optionally sort or exclude frames in the Slideshow side panel.
3. Run **Snailkit: Export slideshow to PowerPoint (.pptx)** from the command palette.
4. On desktop, choose where to save. On mobile, find the file next to the drawing or in your chosen vault folder.

The command appears only while an Excalidraw drawing is active. The module's card explains when Excalidraw is missing or turned off.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Slide size | `16:9` | Choose `16:9`, `16:10`, or `4:3` proportions. |
| Image width | `1920 px` | Choose `1280`, `1920`, `2560`, or `3840` pixels across a full slide. Higher values produce sharper pictures and larger files. A tall frame produces a narrower picture within that slide size. |
| Theme | Same as the drawing | Use the drawing's current theme, or force Light or Dark. |
| Background | On | Pictures and slide bands use the canvas color. Off: transparent pictures on white slides. |
| Save | Ask where to save | Open the system save dialog on desktop, or choose In the vault. Mobile always saves in the vault. |
| Output folder | Empty | For vault exports, empty saves next to the drawing. Otherwise use a folder relative to the vault root, such as `Exports/Decks`, created if needed. **An existing file of the same name is always replaced.** |

## Exact behavior

- Only non-deleted ordinary frames become slides. Excluded frames are always skipped. With no included frames, a notice appears and no file is written.
- Frames with Slideshow metadata come first, sorted by its numeric order, with ties resolved by scene position. Remaining frames sort by name, with the same tie rule. Without metadata, all frames sort by name. Unnamed frames use `Frame 01`, `Frame 02`, and so on, numbered among the non-deleted frames before exclusions.
- Missing or malformed Slideshow metadata falls back to name ordering. A valid metadata object with a missing or invalid order uses zero, matching the source exporter. This script-owned format may change in future Excalidraw releases.
- Framing is always **Clip to the frame**. The frame name and outline are hidden. The image keeps its proportions and is centered, with bands when needed. Overlapping frames render as they overlap. Invalid frame dimensions stop the export with a notice.
- Dark exports transform the canvas color as Excalidraw does; a white canvas becomes `#121212`. Unrecognized canvas colors fall back to white before the theme transformation.
- `Project kickoff.excalidraw.md` exports as `Project kickoff.pptx`. The desktop dialog opens before rendering, remembers its last successful folder, and adds `.pptx` if omitted. Cancelling it renders nothing and writes nothing. If the system dialog is unavailable, the export uses the vault.
- Vault exports use Obsidian's file API, create nested folders, and replace the previous export in place. Two drawings with the same name share an output file if you send them to the same folder. Parent traversal (`..`) and invalid folder paths are rejected. A folder occupying the destination filename stops the export.
- Only one export runs at a time, including across module off/on cycles. Turning the module off hides progress immediately and stops further work after an outstanding render or dialog returns. An already-started filesystem write can finish; it cannot be undone safely. Turning Excalidraw off is checked between export steps and stops the export with a notice.
- Current settings are read on each export. Size, theme, background and resolution are kept consistent for a deck after the save dialog. Output folder is read at save time. Avoid editing or closing the drawing during rendering: it uses the live view.
- The drawing is never modified. Slides contain PNG pictures, so text and shapes are not editable in PowerPoint. Presenter notes, per-element animations and line-based presentations are not exported. Larger decks and higher resolutions use more memory.
- The `.pptx` is a hand-written OOXML package with a stored ZIP container and no extra dependencies. PowerPoint compatibility and actual rendering should be checked in the desktop and mobile apps.
