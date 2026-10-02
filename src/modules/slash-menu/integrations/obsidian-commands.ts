import type { App, Command } from "obsidian";

/**
 * The command registry (`app.commands`) is not part of the typed public API,
 * but it is the stable, universally used way to list and run commands.
 * Everything that touches it lives here, behind defensive checks.
 */
interface CommandRegistry {
	commands: Record<string, Command>;
	listCommands?: () => Command[];
	executeCommandById: (id: string) => boolean;
}

function registry(app: App): CommandRegistry | null {
	const reg = (app as unknown as { commands?: CommandRegistry }).commands;
	return reg && typeof reg.executeCommandById === "function" && typeof reg.commands === "object" ? reg : null;
}

export interface CommandInfo {
	id: string;
	name: string;
	/** Plugin id part (`editor`, `my-table-plugin`), used to group and show the source. */
	source: string;
}

/** All commands currently registered (core, community, dynamic), sorted by name. */
export function listCommands(app: App): CommandInfo[] {
	const reg = registry(app);
	if (!reg) return [];
	const list = reg.listCommands ? reg.listCommands() : Object.values(reg.commands);
	return list
		.filter((c) => c && typeof c.id === "string")
		.map((c) => ({ id: c.id, name: c.name || c.id, source: c.id.includes(":") ? c.id.slice(0, c.id.indexOf(":")) : "" }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCommand(app: App, id: string): Command | null {
	return registry(app)?.commands[id] ?? null;
}

export function commandExists(app: App, id: string): boolean {
	return getCommand(app, id) !== null;
}

/** Cheap fingerprint to know whether the command list changed since last time. */
export function commandsFingerprint(app: App): number {
	const reg = registry(app);
	return reg ? Object.keys(reg.commands).length : 0;
}

/** Runs a command. Returns false when it does not exist or refused to run. */
export function executeCommand(app: App, id: string): boolean {
	const reg = registry(app);
	if (!reg || !reg.commands[id]) return false;
	return reg.executeCommandById(id) !== false;
}
