// Actions: what can be done with this note, in one place. "Insert" lists what Obsidian can put
// at the cursor (a table, a callout, a drawing with the Excalidraw plugin...), while the note is
// being edited. "This note" lists what the running Snailkit modules declared (export to PDF, move
// the selection to a new note...). Every row runs, then the panel closes.
import { Platform, type MarkdownView } from "obsidian";
import type { PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { RowList } from "../rows";
import { INSERTS, insertsAvailable, type CommandIndex } from "./inserts";

export const actionsPanel: PanelDefinition = {
	id: "actions",
	icon: "sparkles",
	isAvailable: (_env, view) => view.file?.extension === "md",
	create: (ctx, body) => new ActionsPanel(ctx, body),
};

interface CommandsLike {
	commands?: CommandIndex;
	executeCommandById?(id: string): boolean;
}

class ActionsPanel implements PanelInstance {
	private rows: RowList;
	private destroyed = false;

	constructor(private ctx: PanelContext, private body: HTMLElement) {
		body.addClass("sk-note-rail-actions");
		this.rows = new RowList(body);
		this.build();
	}

	refresh(): void {
		if (!this.destroyed) this.build();
	}

	destroy(): void {
		this.destroyed = true;
		this.rows.destroy();
		this.body.empty();
	}

	private commands(): CommandsLike {
		return (this.ctx.app as unknown as { commands?: CommandsLike }).commands ?? {};
	}

	private build(): void {
		const { ctx } = this;
		const t = ctx.t.bind(ctx);
		const view = ctx.view;
		const focusKey = this.rows.focusedKey();
		this.body.empty();
		this.rows.clear();
		let any = false;

		if (view.getMode() === "source") {
			const inserts = insertsAvailable(INSERTS, this.commands().commands ?? {});
			if (inserts.length) {
				any = true;
				this.rows.section(this.body, t("actions.insert"));
				for (const insert of inserts) {
					const command = insert.command;
					if (command) this.rows.row(this.body, t(`actions.${insert.id}`), `i:${insert.id}`, () => this.insert(command), { icon: insert.icon });
					else this.rows.row(this.body, t(`actions.${insert.id}`), `i:${insert.id}`, (e) => ctx.openPanel("callout", !("button" in e)), { icon: insert.icon, chevron: true });
				}
			}
		}

		const actions = this.safe(() => ctx.noteActions().filter((a) => this.safe(() => a.available(view), false)), []);
		if (actions.length) {
			any = true;
			this.rows.section(this.body, t("actions.note"));
			for (const a of actions) {
				this.rows.row(this.body, a.label, `a:${a.key}`, () => this.run(() => void a.run(view)), { icon: a.icon });
			}
		}

		if (!any) this.body.createDiv({ cls: "sk-note-rail-empty", text: t(view.getMode() === "source" ? "actions.empty" : "actions.empty-reading") });
		this.rows.focus(focusKey);
	}

	/** An Obsidian editor command needs the active editor: this note's pane first, then the command. */
	private insert(command: string): void {
		const { ctx } = this;
		this.run(() => {
			ctx.app.workspace.setActiveLeaf(ctx.view.leaf, { focus: true });
			if (!Platform.isMobile) ctx.view.editor.focus();
			this.commands().executeCommandById?.(command);
		});
	}

	/** Run, then close: the action leads to a dialog, a file or a change in the note. */
	private run(action: () => void): void {
		if (!this.destroyed) this.ctx.close("commit");
		try {
			action();
		} catch (err) {
			console.error("[Snailkit] note-rail: action", err);
		}
	}

	private safe<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch (err) {
			console.error("[Snailkit] note-rail: actions", err);
			return fallback;
		}
	}
}

export type { MarkdownView };
