/** A self-contained miniature; CSS owns the entire playback lifecycle. */
export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const ns = "http://www.w3.org/2000/svg";
	const svg = el.ownerDocument.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 320 200");
	svg.setAttribute("width", "100%");
	svg.setAttribute("height", "100%");
	svg.setAttribute("aria-hidden", "true");
	el.appendChild(svg);
	const draw = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
		const node = el.ownerDocument.createElementNS(ns, tag);
		for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
		parent.appendChild(node);
		return node;
	};
	const group = (name: string, parent: Element = svg) => draw("g", { class: "sk-demo-pdf-export-" + name }, parent);
	const box = (x: number, y: number, width: number, height: number, name = "paper", parent: Element = svg) => draw("rect", { x, y, width, height, rx: 4, class: "sk-demo-pdf-export-" + name }, parent);
	const text = (x: number, y: number, value: string, name = "text", parent: Element = svg) => {
		const node = draw("text", { x, y, class: "sk-demo-pdf-export-" + name }, parent);
		node.textContent = value;
	};
	const path = (d: string, name = "line", parent: Element = svg) => draw("path", { d, class: "sk-demo-pdf-export-" + name }, parent);
	const content = (parent: Element, x: number, y: number) => {
		text(x, y, "Project X", "title", parent);
		box(x, y + 12, 87, 3, "bar", parent); box(x, y + 21, 72, 3, "bar", parent);
		box(x, y + 34, 91, 44, "wash", parent);
		path("M" + (x + 8) + " " + (y + 67) + " l20 -20 17 16 16 -10 20 14", "accent", parent);
		draw("circle", { cx: x + 72, cy: y + 45, r: 4, class: "sk-demo-pdf-export-bar" }, parent);
		text(x, y + 97, "Meeting notes ↗", "link", parent);
		box(x, y + 109, 80, 3, "bar", parent);
	};
	box(18, 24, 129, 151); text(30, 39, "Project X.md", "small"); content(svg, 34, 60);
	const after = group("after"); box(180, 17, 122, 166, "paper", after);
	content(after, 195, 43); text(232, 173, "1 / 1", "small", after);
	text(186, 195, "Project X.pdf", "small", after);
	path("M153 99 H173 m-5 -5 5 5 -5 5", "accent");
	const gesture = group("gesture"); box(76, 151, 174, 27, "paper", gesture);
	text(88, 168, t("demo.export"), "text", gesture);
}
