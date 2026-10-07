// A tag as a capsule: its family in small capitals on a tinted ground, then the rest. Colored by
// Tag colors when that module is on (its classes set --sk-tag-*), neutral otherwise.

export function tagCapsule(doc: Document, tag: string, classes: string): HTMLElement {
	const parts = tag.replace(/^#/, "").split("/");
	const el = doc.createElement("span");
	el.className = `sk-tag-capsule ${classes}`.trim();
	el.dataset.tag = tag;
	const root = el.createSpan();
	root.className = "sk-tag-capsule-root";
	root.textContent = parts[0];
	if (parts.length > 1) {
		const leaf = el.createSpan();
		leaf.className = "sk-tag-capsule-leaf";
		leaf.textContent = parts.slice(1).join(" › ");
	}
	return el;
}
