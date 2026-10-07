/** A self-contained miniature; CSS owns the entire playback lifecycle. */
export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const ns = "http://www.w3.org/2000/svg";
	const svg = el.ownerDocument.createElementNS(ns, "svg");
	for (const [key, value] of Object.entries({ viewBox: "0 0 320 200", width: "100%", height: "100%", "aria-hidden": "true" })) svg.setAttribute(key, value);
	el.appendChild(svg);
	const draw = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
		const node = el.ownerDocument.createElementNS(ns, tag);
		for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
		parent.appendChild(node);
		return node;
	};
	const group = (name: string, parent: Element = svg) => draw("g", { class: "sk-demo-move-text-" + name }, parent);
	const box = (x: number, y: number, width: number, height: number, name = "paper", parent: Element = svg) => draw("rect", { x, y, width, height, rx: 4, class: "sk-demo-move-text-" + name }, parent);
	const text = (x: number, y: number, value: string, name = "text", parent: Element = svg) => {
		const node = draw("text", { x, y, class: "sk-demo-move-text-" + name }, parent);
		node.textContent = value;
		return node;
	};
	box(12, 26, 142, 134);
	text(24, 55, "Project X", "title");
	text(24, 74, "Project outline", "text");
	text(24, 126, "Review the draft.", "text");
	text(24, 142, "Share the next steps.", "text");
	const destination = group("destination");
	box(174, 26, 134, 134, "paper", destination);
	text(186, 55, "Redesign idea", "title", destination);
	// The same two lines lift from the source and settle inside the new note.
	const passage = group("passage");
	box(21, 79, 121, 33, "selection", passage);
	text(24, 91, "Keep the navigation", "text", passage);
	text(24, 107, "clear and focused.", "text", passage);
	text(24, 96, "[[Redesign idea]]", "link");
	const caption = text(160, 183, t("demo.extract"), "caption");
	caption.setAttribute("text-anchor", "middle");
}
