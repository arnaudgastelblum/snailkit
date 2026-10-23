// The scene of the card in the settings showcase (docs/showcase.md): three tabs, the right button
// draws down then right over the middle one, its name shows, and on release the tab closes.
const NS = "http://www.w3.org/2000/svg";

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const doc = el.ownerDocument;
	const svg = doc.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 320 200");
	svg.setAttribute("width", "100%");
	svg.setAttribute("height", "100%");
	svg.setAttribute("aria-hidden", "true");
	el.appendChild(svg);
	const draw = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
		const node = doc.createElementNS(NS, tag);
		for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
		parent.appendChild(node);
		return node;
	};
	const cls = (name: string) => "sk-demo-mouse-gestures-" + name;
	const group = (name: string, parent: Element = svg) => draw("g", { class: cls(name) }, parent);
	const text = (x: number, y: number, value: string, name: string, parent: Element = svg) => {
		draw("text", { x, y, class: cls(name) }, parent).textContent = value;
	};
	const bars = (widths: number[], parent: Element) => widths.forEach((w, i) => draw("rect", { x: 36, y: 82 + i * 16, width: w, height: 5, rx: 2.5, class: cls("bar") }, parent));

	// The window and its tab strip.
	draw("rect", { x: 14, y: 14, width: 292, height: 172, rx: 7, class: cls("paper") });
	draw("path", { d: "M14 40 V21 a7 7 0 0 1 7 -7 H299 a7 7 0 0 1 7 7 V40 Z", class: cls("strip") });
	const tab = (x: number, width: number, title: string, name: string) => {
		const g = group(name);
		draw("rect", { x, y: 18, width, height: 22, rx: 5, class: cls("tab-bg") }, g);
		text(x + 10, 32, title, "tab", g);
		return g;
	};
	tab(20, 78, "Project X", "tab-first").classList.add(cls("is-plain"));
	tab(102, 98, "Meeting notes", "tab-closing");
	tab(204, 70, "Ideas", "tab-next");

	// The note of the middle tab, then the note that takes its place.
	const before = group("note-before");
	text(36, 66, "Meeting notes", "title", before);
	bars([210, 180, 196, 120, 168], before);
	const after = group("note-after");
	text(36, 66, "Ideas", "title", after);
	bars([150, 200, 92, 176, 132], after);

	// The gesture: down, then right, with the name of its action.
	draw("circle", { cx: 150, cy: 92, r: 3.5, class: cls("press") });
	draw("path", { d: "M150 92 V138 H220", pathLength: 100, class: cls("trail") });
	const chip = group("chip");
	draw("rect", { x: 150, y: 148, width: 118, height: 20, rx: 5, class: cls("chip-bg") }, chip);
	text(159, 161.5, "↓ →", "arrows", chip);
	text(184, 161.5, t("action.close"), "name", chip);
	const cursor = group("cursor");
	draw("path", { d: "M150 92 v13 l3.4 -3.2 l2.6 5.5 l2.3 -1.1 l-2.6 -5.4 l4.7 -0.3 Z", class: cls("pointer") }, cursor);
}
