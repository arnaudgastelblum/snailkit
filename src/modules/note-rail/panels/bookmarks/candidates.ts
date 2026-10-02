// Finding notes to pin: the inline search of the Bookmarks panel and the "Pin a note to this note"
// command share the same candidates and ranking.
import { FuzzySuggestModal, Notice, prepareFuzzySearch, type App, type SearchResult, type TFile } from "obsidian";
import { addNotePin, getNotePins } from "../../pins";
import type { RailEnv } from "../../types";

/** Markdown notes that can be pinned to `file`: every note except itself and the paths in `exclude`. */
export function pinCandidates(app: App, file: TFile, exclude: Iterable<string>): TFile[] {
	const skip = new Set<string>(exclude);
	skip.add(file.path);
	return app.vault.getMarkdownFiles().filter((f) => !skip.has(f.path));
}

export interface RankedNote {
	file: TFile;
	/** Fuzzy match on the note name (null when the query is empty or only the folder path matched). */
	match: SearchResult | null;
}

/**
 * Best candidates for `query`: fuzzy on the note name first, then on the full path (ranked lower).
 * An empty query lists the recently opened notes first, then the rest by name.
 */
export function rankCandidates(app: App, files: TFile[], query: string, limit: number): RankedNote[] {
	const q = query.trim();
	if (!q) {
		const recent = new Map<string, number>();
		app.workspace.getLastOpenFiles().forEach((p, i) => recent.set(p, i));
		const rank = (f: TFile) => recent.get(f.path) ?? Infinity;
		return files
			.slice()
			.sort((a, b) => rank(a) - rank(b) || a.basename.localeCompare(b.basename))
			.slice(0, limit)
			.map((file) => ({ file, match: null }));
	}
	const fuzzy = prepareFuzzySearch(q);
	const scored: { file: TFile; match: SearchResult | null; score: number }[] = [];
	for (const file of files) {
		const onName = fuzzy(file.basename);
		if (onName) {
			scored.push({ file, match: onName, score: onName.score });
			continue;
		}
		const onPath = fuzzy(file.path);
		if (onPath) scored.push({ file, match: null, score: onPath.score - 1 });
	}
	scored.sort((a, b) => b.score - a.score || a.file.basename.length - b.file.basename.length);
	return scored.slice(0, limit).map(({ file, match }) => ({ file, match }));
}

/** Writes `text` into `el`, the matched ranges wrapped in Obsidian's highlight class. */
export function renderHighlighted(el: HTMLElement, text: string, matches: [number, number][] | null): void {
	let at = 0;
	for (const [start, end] of (matches ?? []).slice().sort((a, b) => a[0] - b[0])) {
		if (start < at || end <= start) continue;
		if (start > at) el.appendText(text.slice(at, start));
		el.createSpan({ cls: "suggestion-highlight", text: text.slice(start, end) });
		at = end;
	}
	if (at < text.length) el.appendText(text.slice(at));
}

/**
 * Command palette flavour of "Pin a note here": a fuzzy modal over the notes of the vault.
 * `isAlive` turns a late choice into a no-op once the module is off; `onClosed` lets the module
 * track open modals and close them when it stops.
 */
export class PinNoteModal extends FuzzySuggestModal<TFile> {
	constructor(
		private env: RailEnv,
		private file: TFile,
		private isAlive: () => boolean,
		private onClosed: () => void,
	) {
		super(env.app);
		this.setPlaceholder(env.t("bookmarks.modal", { name: file.basename }));
	}

	getItems(): TFile[] {
		return pinCandidates(this.app, this.file, getNotePins(this.app, this.file, this.env.settings).map((f) => f.path));
	}

	getItemText(item: TFile): string {
		return item.path.replace(/\.md$/i, "");
	}

	onClose(): void {
		super.onClose();
		this.onClosed();
	}

	onChooseItem(item: TFile): void {
		if (!this.isAlive()) return;
		addNotePin(this.app, this.file, item, this.env.settings).then(
			() => new Notice(this.env.t("bookmarks.pinned", { name: item.basename, note: this.file.basename })),
			(err) => {
				console.error("[Snailkit] note-rail: could not pin", err);
				new Notice(this.env.t("bookmarks.save-error"));
			},
		);
	}
}
