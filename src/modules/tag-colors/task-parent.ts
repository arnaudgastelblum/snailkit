/** What Tags uses of the optional Tasks service. */
export interface TasksApi {
	/** The open task whose note is `path`; its checkboxes are that task's steps. */
	parentOf?(path: string): { key: string; tag: string; title: string; plainTitle: string } | null;
	on(event: "change", callback: () => void): () => void;
}

export interface ParentSuggestion { tag: string; task: string }

/** No default for an untagged parent or a priority group. */
export function parentSuggestion(parent: { tag: string; plainTitle: string } | null | undefined): ParentSuggestion | null {
	if (!parent || !/^[\p{L}\p{N}_/-]+$/u.test(parent.tag) || !/[\p{L}_/-]/u.test(parent.tag) || /^(?:high|medium|low)$/i.test(parent.tag)) return null;
	const title = Array.from(parent.plainTitle.trim());
	return { tag: parent.tag.toLowerCase(), task: title.length > 80 ? title.slice(0, 79).join("") + "…" : title.join("") };
}

/** Keep the parent's tag first without offering a second spelling of it. */
export function parentFirst(near: string[], parent: ParentSuggestion | null): string[] {
	return parent ? [parent.tag, ...near.filter(tag => tag.replace(/^#/, "").toLowerCase() !== parent.tag)] : near;
}
