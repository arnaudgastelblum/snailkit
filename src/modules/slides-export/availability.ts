import type { App } from "obsidian";

const PLUGIN_ID = "obsidian-excalidraw-plugin";
export function unavailableReason(app: App, t: (key: string) => string): string | null {
	const manager = (app as unknown as {
		plugins?: { manifests?: Record<string, unknown>; plugins?: Record<string, unknown> };
	}).plugins;
	if (manager?.plugins?.[PLUGIN_ID]) return null;
	return t(manager?.manifests?.[PLUGIN_ID] ? "reason.disabled" : "reason.missing");
}
