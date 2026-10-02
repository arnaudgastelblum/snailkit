// Destination writes finish before the origin editor is changed.
import { MarkdownView, Notice, TFile, moment, normalizePath, type Editor } from "obsidian";
import type { Context, Block, Payload, ExtractTarget, AppendTarget } from "./types";
import { fenceStates, frontmatterEnd, findZone, sectionBounds, FENCE_RE, proposeTitle, sanitizeFilename, leadingHeadingText, prepareSubnoteBody, trimmedBody, isArchiveBasename, formatProvenance } from "./logic";
import { blockUnchanged, replaceBlock, insertLinkInZone } from "./editor";
import { ExtractTargetModal, ArchiveTitleModal, AppendTargetModal } from "./modals";

export class MoveTextActions {
	constructor(private readonly ctx: Context) {}
	private get app() { return this.ctx.app; }
	private get settings() { return this.ctx.settings; }

	// The block to act on: the selection extended to full lines, or, without
	// a selection, the heading section around the cursor. Refuses blocks that
	// touch the frontmatter or cut a code fence in two.
	getBlock(editor: Editor): Block | null {
		const source = editor.getValue();
		const all = source.split(/\r?\n/);
		const state = fenceStates(all);
		let start, end;

		if (editor.somethingSelected()) {
			const from = editor.getCursor("from");
			const to = editor.getCursor("to");
			start = from.line;
			end = to.line;
			if (to.ch === 0 && end > start) end--;
		} else {
			const bounds = sectionBounds(all, editor.getCursor().line);
			if (!bounds) {
				new Notice(this.ctx.t("error.heading"));
				return null;
			}
			({ start, end } = bounds);
		}

		const fmEnd = frontmatterEnd(all);
		if (fmEnd !== -1 && start <= fmEnd) {
			new Notice(this.ctx.t("error.frontmatter"));
			return null;
		}
		if (state[start] || state[end + 1]) {
			new Notice(this.ctx.t("error.fence"));
			return null;
		}
		const lines = all.slice(start, end + 1);
		if (lines.join("\n").trim() === "") {
			new Notice(this.ctx.t("error.empty"));
			return null;
		}
		return { start, end, lines, source };
	}

	today() {
		return moment().locale("en").format(this.settings.dateFormat || "YYYY-MM-DD");
	}

	// Keep file names and generated links consistent after sanitizing.
	archiveBasename(originFile: TFile) {
		return sanitizeFilename(originFile.basename + this.ctx.t("note.archive-suffix"));
	}

	// Prefer a known archive in the configured folder, then one linked by the origin.
	findArchive(editor: Editor, originFile: TFile): TFile | null {
		const suffixes = this.ctx.translators().map((t) => t.t("note.archive-suffix"));
		const folder = normalizePath(this.settings.archiveFolder || "");
		for (const suffix of suffixes) {
			const base = sanitizeFilename(originFile.basename + suffix);
			const path = normalizePath((folder && folder !== "/" ? folder + "/" : "") + base + ".md");
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && file.path !== originFile.path) return file;
		}
		for (const link of findZone(editor.getValue().split(/\r?\n/)).links) {
			const file = this.app.metadataCache.getFirstLinkpathDest(link, originFile.path);
			if (file instanceof TFile && file.extension === "md" && file.path !== originFile.path &&
				isArchiveBasename(file.basename, originFile.basename, suffixes)) return file;
		}
		return null;
	}

	// Existing sub-notes of a note: files named "<note> - ..." plus the
	// targets of the top link zone (minus the archive and the note itself).
	findSubnotes(editor: Editor, originFile: TFile) {
		const prefix = originFile.basename + " - ";
		const suffixes = this.ctx.translators().map((t) => t.t("note.archive-suffix"));
		const isArchive = (name: string) => isArchiveBasename(name, originFile.basename, suffixes);
		const found = new Map<string, TFile>();
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (
				f.path !== originFile.path &&
				!isArchive(f.basename) &&
				f.basename.startsWith(prefix)
			) {
				found.set(f.path, f);
			}
		}
		const { links } = findZone(editor.getValue().split(/\r?\n/));
		for (const link of links) {
			if (isArchive(link.split("/").pop()!)) continue;
			const f = this.app.metadataCache.getFirstLinkpathDest(
				link,
				originFile.path
			);
			if (f instanceof TFile && f.extension === "md" && f.path !== originFile.path && !isArchive(f.basename)) {
				found.set(f.path, f);
			}
		}
		return [...found.values()].sort((a, b) =>
			a.basename.localeCompare(b.basename)
		);
	}

	provenance(originFile: TFile) {
		return formatProvenance(this.ctx.t("note.extracted"), originFile.basename, this.today());
	}

	async ensureFolder(path: string) {
		const parts = normalizePath(path).split("/").filter(Boolean);
		let cur = "";
		for (const part of parts) {
			cur = cur ? cur + "/" + part : part;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				try {
					await this.app.vault.createFolder(cur);
				} catch (error) {
					// A concurrent folder creation is fine; real failures must abort.
					if (!this.app.vault.getAbstractFileByPath(cur)) throw error;
				}
			}
		}
	}

	async updateDestination(file: TFile, update: (data: string) => string): Promise<void> {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active?.file === file) {
			const editor = active.editor;
			const last = editor.lineCount() - 1;
			editor.replaceRange(update(editor.getValue().split(/\r?\n/).join("\n")),
				{ line: 0, ch: 0 }, { line: last, ch: editor.getLine(last).length });
		} else {
			await this.app.vault.process(file, (data) => update(data.split(/\r?\n/).join("\n")));
		}
	}

	// Recheck after folder creation and handle a file appearing during create.
	async writeDestination(path: string, initial: string, update: (data: string) => string): Promise<TFile> {
		let existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			try {
				return await this.app.vault.create(path, initial);
			} catch (error) {
				existing = this.app.vault.getAbstractFileByPath(path);
				if (!(existing instanceof TFile)) throw error;
			}
		}
		if (!(existing instanceof TFile)) throw new Error(this.ctx.t("error.folder", { path }));
		await this.updateDestination(existing, update);
		return existing;
	}

	async appendToNote(file: TFile, originFile: TFile, body: string) {
		const prov = this.settings.provenanceLine
			? this.provenance(originFile) + "\n\n"
			: "";
		await this.updateDestination(
			file,
			(data) => data.trimEnd() + "\n\n" + prov + body + "\n"
		);
	}

	// ------------------------------------------------------------- extract

	extract(editor: Editor, view: { file: TFile | null }) {
		const originFile = view.file;
		if (!originFile) return;
		const block = this.getBlock(editor);
		if (!block) return;
		block.isCurrent = () => view.file === originFile;

		const prefix = this.settings.prefixSubnoteName
			? originFile.basename + " - "
			: "";
		const proposedTitle = proposeTitle(block.lines);
		const existing = this.findSubnotes(editor, originFile);

		new ExtractTargetModal(
			this.ctx,
			prefix,
			proposedTitle,
			existing,
			(item) => {
				this.doExtract(editor, originFile, block, item).catch((e) => {
					console.error("Snailkit move-text: extraction failed", e);
					new Notice(this.ctx.t("error.extract", { message: String(e instanceof Error ? e.message : e) }));
				});
			}
		).open();
	}

	async doExtract(editor: Editor, originFile: TFile, block: Block, item: ExtractTarget) {
		let targetBase;

		// Destination first: the origin note is only touched once the
		// content is safely written somewhere else.
		if (item.type === "append") {
			if (item.file.path === originFile.path) {
				new Notice(this.ctx.t("error.origin"));
				return;
			}
			targetBase = item.file.basename;
			await this.appendToNote(item.file, originFile, trimmedBody(block.lines));
		} else {
			targetBase = sanitizeFilename(item.name);
			if (!targetBase) {
				new Notice(this.ctx.t("error.name"));
				return;
			}
			const parent = originFile.parent;
			const folder =
				parent && parent.path && parent.path !== "/" ? parent.path + "/" : "";
			const path = normalizePath(folder + targetBase + ".md");
			if (path === originFile.path) {
				new Notice(this.ctx.t("error.origin"));
				return;
			}
			const already = this.app.vault.getAbstractFileByPath(path);
			if (already instanceof TFile) {
				// Name collision: never overwrite, append instead.
				await this.appendToNote(already, originFile, trimmedBody(block.lines));
			} else {
				// The heading only becomes the file name when the title kept
				// its text: with a custom title it must stay in the body.
				const heading = leadingHeadingText(block.lines);
				const prefix = this.settings.prefixSubnoteName
					? originFile.basename + " - "
					: "";
				const dropHeading =
					heading !== null &&
					targetBase === sanitizeFilename(prefix + heading);
				const prov = this.settings.provenanceLine
					? this.provenance(originFile) + "\n\n"
					: "";
				await this.writeDestination(
					path,
					prov + prepareSubnoteBody(block.lines, dropHeading) + "\n",
					(data) => data.trimEnd() + "\n\n" + prov + trimmedBody(block.lines) + "\n"
				);
			}
		}

		if (!blockUnchanged(editor, block)) {
			new Notice(
				this.ctx.t("notice.changed", { name: targetBase, linked: "" })
			);
			return;
		}
		replaceBlock(editor, block.start, block.end, "");
		insertLinkInZone(editor, targetBase);
		this.ctx.toast(this.ctx.t("notice.extracted", { name: targetBase }));
	}

	// ------------------------------------------------------------- archive

	archive(editor: Editor, view: { file: TFile | null }) {
		const originFile = view.file;
		if (!originFile) return;
		const block = this.getBlock(editor);
		if (!block) return;
		block.isCurrent = () => view.file === originFile;

		new ArchiveTitleModal(this.ctx, this.today(), (title) => {
			this.doArchive(editor, originFile, block, title).catch((e) => {
				console.error("Snailkit move-text: archiving failed", e);
				new Notice(this.ctx.t("error.archive", { message: String(e instanceof Error ? e.message : e) }));
			});
		}).open();
	}

	async doArchive(editor: Editor, originFile: TFile, block: Block, title: string) {
		const date = this.today();
		const header = title ? `## ${title} (${date})` : `## ${date}`;
		const body = trimmedBody(block.lines);
		const foundArchive = this.findArchive(editor, originFile);
		const archiveBase = foundArchive?.basename ?? this.archiveBasename(originFile);

		const folder = normalizePath(this.settings.archiveFolder || "");
		if (!foundArchive && folder && folder !== "/") await this.ensureFolder(folder);
		const path = foundArchive?.path ?? normalizePath(
			(folder && folder !== "/" ? folder + "/" : "") + archiveBase + ".md"
		);
		if (path === originFile.path) {
			new Notice(this.ctx.t("error.origin"));
			return;
		}

		// Destination first, origin second: no content loss possible.
		await this.writeDestination(path,
			this.ctx.t("note.archive", { origin: originFile.basename }) + "\n\n" + header + "\n\n" + body + "\n",
			(data) => data.trimEnd() + "\n\n" + header + "\n\n" + body + "\n");

		if (!blockUnchanged(editor, block)) {
			new Notice(
				this.ctx.t("notice.changed", { name: archiveBase, linked: "" })
			);
			return;
		}
		replaceBlock(editor, block.start, block.end, "");
		// Reuse a qualified or aliased link instead of adding a second archive link.
		const linked = findZone(editor.getValue().split(/\r?\n/)).links.find((link) =>
			this.app.metadataCache.getFirstLinkpathDest(link, originFile.path)?.path === path);
		insertLinkInZone(editor, linked ?? archiveBase);
		this.ctx.toast(this.ctx.t("notice.archived", { name: archiveBase }));
	}

	// ----------------------------------------------------------- append to

	// With a selection: exactly the selected text (not extended to full
	// lines). Without one: the heading section around the cursor, as for the
	// other commands.
	getSelectionPayload(editor: Editor): Payload | null {
		if (!editor.somethingSelected()) {
			const block = this.getBlock(editor);
			return block ? { block, text: trimmedBody(block.lines) } : null;
		}
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const endLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
		const source = editor.getValue();
		const all = source.split(/\r?\n/);
		const fmEnd = frontmatterEnd(all);
		if (fmEnd !== -1 && from.line <= fmEnd) {
			new Notice(this.ctx.t("error.frontmatter"));
			return null;
		}
		const state = fenceStates(all);
		// Fine inside one code block (no fence line crossed) or outside any.
		const cutsFence = state[from.line]
			? all.slice(from.line, endLine + 1).some((l) => FENCE_RE.test(l))
			: state[endLine + 1];
		if (cutsFence) {
			new Notice(this.ctx.t("error.fence"));
			return null;
		}
		const raw = editor.getRange(from, to);
		const text = trimmedBody(raw.split(/\r?\n/));
		if (text.trim() === "") {
			new Notice(this.ctx.t("error.empty"));
			return null;
		}
		return { range: { from, to, endLine, raw, source }, text };
	}

	appendTo(editor: Editor, view: { file: TFile | null }) {
		const originFile = view.file;
		if (!originFile) return;
		const payload = this.getSelectionPayload(editor);
		if (!payload) return;
		(payload.block ?? payload.range).isCurrent = () => view.file === originFile;
		new AppendTargetModal(this.ctx, originFile, (item, keep) => {
			this.doAppendTo(editor, originFile, payload, item, keep).catch((e) => {
				console.error("Snailkit move-text: append failed", e);
				new Notice(this.ctx.t("error.append", { message: String(e instanceof Error ? e.message : e) }));
			});
		}).open();
	}

	// item: { type: "file", file } to append, { type: "create", path } for a
	// new note (appended to instead if the path exists by then).
	async doAppendTo(editor: Editor, originFile: TFile, payload: Payload, item: AppendTarget, keep: boolean) {
		const path = item.type === "create" ? item.path : item.file.path;
		if (path === originFile.path) {
			new Notice(this.ctx.t("error.origin"));
			return;
		}
		// Destination first: the origin note is only touched once the
		// content is safely written somewhere else.
		const prov = this.settings.provenanceLine
			? formatProvenance(this.ctx.t(keep ? "note.copied" : "note.moved"), originFile.basename, this.today()) + "\n\n"
			: "";
		if (!this.app.vault.getAbstractFileByPath(path)) {
			const slash = path.lastIndexOf("/");
			if (slash > 0) await this.ensureFolder(path.slice(0, slash));
		}
		const file = await this.writeDestination(path, prov + payload.text + "\n", (data) => {
			const head = data.trimEnd();
			return (head ? head + "\n\n" : "") + prov + payload.text + "\n";
		});
		const linked = (await this.copyLinkToClipboard(file, originFile))
			? this.ctx.t("notice.clipboard")
			: "";
		if (keep) {
			this.ctx.toast(this.ctx.t("notice.copied", { name: file.basename, linked }));
			return;
		}

		const { block, range } = payload;
		const unchanged = block
			? blockUnchanged(editor, block)
			: editor.getValue() === range.source && range.isCurrent?.() !== false &&
				range.to.line < editor.lineCount() &&
				editor.getRange(range.from, range.to) === range.raw;
		if (!unchanged) {
			new Notice(
				this.ctx.t("notice.changed", { name: file.basename, linked })
			);
			return;
		}
		if (block) {
			replaceBlock(editor, block.start, block.end, "");
		} else if (
			range.from.ch === 0 &&
			(range.to.line > range.endLine ||
				range.to.ch === editor.getLine(range.to.line).length)
		) {
			// Whole lines selected: remove the lines, not just their text,
			// so no empty line is left behind.
			replaceBlock(editor, range.from.line, range.endLine, "");
		} else {
			editor.replaceRange("", range.from, range.to);
		}
		this.ctx.toast(this.ctx.t("notice.moved", { name: file.basename, linked }));
	}

	// "[[Note]]" to paste elsewhere. The link text is the shortest one that
	// resolves to this file (a folder path only when the name is ambiguous).
	// false when the clipboard is unavailable: the move itself still counts.
	async copyLinkToClipboard(file: TFile, originFile: TFile) {
		const text = this.app.metadataCache.fileToLinktext(file, originFile.path, true);
		try {
			await navigator.clipboard.writeText(`[[${text}]]`);
			return true;
		} catch (e) {
			console.warn("Snailkit move-text: could not copy the link", e);
			return false;
		}
	}
}
