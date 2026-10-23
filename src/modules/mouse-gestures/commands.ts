// The commands of Obsidian and of its plugins, for custom gestures: their names, whether one is
// there now (its plugin may be off), and a window to choose one, searched like the command palette.
import { FuzzySuggestModal, type App } from "obsidian";

interface CommandInfo {
	id: string;
	name: string;
}

interface CommandRegistry {
	commands?: Record<string, CommandInfo>;
	listCommands?(): CommandInfo[];
	executeCommandById?(id: string): boolean;
}

function registry(app: App): CommandRegistry | undefined {
	return (app as unknown as { commands?: CommandRegistry }).commands;
}

/**
 * Every command, sorted by name. All of them, not only those available now (the command palette's
 * list): the picker opens in the settings, where the commands of an editor or a view are not.
 */
export function allCommands(app: App): CommandInfo[] {
	const reg = registry(app);
	const list = reg?.commands ? Object.values(reg.commands) : reg?.listCommands?.() ?? [];
	return list.filter((c) => typeof c?.id === "string" && typeof c.name === "string").sort((a, b) => a.name.localeCompare(b.name));
}

/** The name of a command, or null when it is not there (its plugin is off or gone). */
export function commandName(app: App, id: string): string | null {
	const name = registry(app)?.commands?.[id]?.name;
	return typeof name === "string" ? name : null;
}

/** Runs a command as its hotkey would. False when it is not there. */
export function runCommand(app: App, id: string): boolean {
	const reg = registry(app);
	if (!reg?.commands?.[id] || !reg.executeCommandById) return false;
	return reg.executeCommandById(id);
}

/** The window to choose a command for a new gesture. */
export class CommandPicker extends FuzzySuggestModal<CommandInfo> {
	constructor(
		app: App,
		placeholder: string,
		private readonly chosen: (id: string) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): CommandInfo[] {
		return allCommands(this.app);
	}

	getItemText(item: CommandInfo): string {
		return item.name;
	}

	onChooseItem(item: CommandInfo): void {
		this.chosen(item.id);
	}
}
