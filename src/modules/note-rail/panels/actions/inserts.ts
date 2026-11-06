// What the Actions panel can insert at the cursor: Obsidian's own editor commands (and the
// Excalidraw plugin's, when it is installed), listed only when the command exists; and callouts,
// written by the panel itself with the type chosen in its sub-panel. Pure, tested in
// test/note-rail.test.ts.

export interface Insert {
	/** Also the string key `actions.<id>`. */
	id: string;
	icon: string;
	/** The command run (Obsidian's or a plugin's), or null for an insert the panel writes itself. */
	command: string | null;
}

/** `app.commands.commands`: every registered command by id. */
export type CommandIndex = Record<string, unknown>;

export const INSERTS: readonly Insert[] = [
	{ id: "table", icon: "table", command: "editor:insert-table" },
	// Opens the Callout sub-panel (choice of the type).
	{ id: "callout", icon: "square-chevron-right", command: null },
	{ id: "code", icon: "code", command: "editor:insert-codeblock" },
	{ id: "rule", icon: "minus", command: "editor:insert-horizontal-rule" },
	// Excalidraw: a new drawing in a new tab, embedded here.
	{ id: "drawing", icon: "pencil-ruler", command: "obsidian-excalidraw-plugin:excalidraw-autocreate-and-embed-new-tab" },
];

/** The inserts available right now (a command insert needs its command registered), in order. */
export function insertsAvailable(inserts: readonly Insert[], commands: CommandIndex): Insert[] {
	return inserts.filter((insert) => insert.command === null || Object.prototype.hasOwnProperty.call(commands, insert.command));
}

/** The callout types offered (Obsidian's own names, written as is in the note), with an icon and a color. */
export const CALLOUTS: readonly { type: string; icon: string; color: string }[] = [
	{ type: "note", icon: "pencil", color: "blue" },
	{ type: "info", icon: "info", color: "blue" },
	{ type: "tip", icon: "flame", color: "cyan" },
	{ type: "success", icon: "check", color: "green" },
	{ type: "question", icon: "circle-help", color: "yellow" },
	{ type: "warning", icon: "triangle-alert", color: "orange" },
	{ type: "danger", icon: "zap", color: "red" },
	{ type: "example", icon: "list", color: "purple" },
	{ type: "quote", icon: "quote", color: "gray" },
];

/**
 * The text of a callout of `type`. With selected text, the selection becomes its body (each line
 * quoted); without, an empty body line where the cursor goes (`cursor`: offset in the text).
 */
export function calloutText(type: string, selection: string): { text: string; cursor: number } {
	const head = `> [!${type}]\n`;
	if (!selection.trim()) {
		const text = head + "> ";
		return { text, cursor: text.length };
	}
	const body = selection.replace(/\n$/, "").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
	const text = head + body;
	return { text, cursor: text.length };
}
