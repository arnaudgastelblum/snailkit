import { Notice } from "obsidian";
import { captureTarget, insertText } from "../editor/insert";
import type { NewNoteActionConfig } from "../types/settings";
import { renderVariables, sanitizeFileName } from "../utils/variables";
import { availablePath, ensureFolder } from "../utils/vault";
import type { ActionType } from "./types";

export const newNoteAction: ActionType<NewNoteActionConfig> = {
	type: "new-note",
	isAvailable: () => ({ available: true }),
	async execute(config, ctx) {
		const target = ctx.editor ? captureTarget(ctx, ctx.editor) : undefined;
		const vars = { settings: ctx.settings, file: ctx.file, selection: ctx.selection };
		const name = sanitizeFileName(await renderVariables(config.nameTemplate, vars)) || ctx.host.t("entry.new-note.name");
		if (!ctx.host.active()) return;
		const folderPath = config.folder.trim()
			? await ensureFolder(ctx.app, await renderVariables(config.folder, vars))
			: ctx.app.fileManager.getNewFileParent(ctx.file?.path ?? "").path;
		const path = availablePath(ctx.app, folderPath === "/" ? "" : folderPath, name, ".md");
		if (!ctx.host.active()) return;
		const file = await ctx.app.vault.create(path, "");
		if (!ctx.host.active()) return;

		if (config.insertLink && ctx.editor) {
			insertText(ctx, ctx.editor, ctx.app.fileManager.generateMarkdownLink(file, ctx.file?.path ?? ""), target);
		}
		if (config.openInNewTab) await ctx.app.workspace.getLeaf("tab").openFile(file, { active: true });
		else if (!config.insertLink || !ctx.editor) new Notice(ctx.host.t("notice.noteCreated", { path: file.path }));
	},
};
