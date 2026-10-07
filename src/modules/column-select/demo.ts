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
	const group = (name: string, parent: Element = svg) => draw("g", { class: "sk-demo-column-select-" + name }, parent);
	const box = (x: number, y: number, width: number, height: number, name = "paper", parent: Element = svg) => draw("rect", { x, y, width, height, rx: 4, class: "sk-demo-column-select-" + name }, parent);
	const text = (x: number, y: number, value: string, name = "text", parent: Element = svg) => {
		const node = draw("text", { x, y, class: "sk-demo-column-select-" + name }, parent);
		node.textContent = value;
	};
	const path = (d: string, name = "line", parent: Element = svg) => draw("path", { d, class: "sk-demo-column-select-" + name }, parent);
	box(18, 18, 284, 165); text(36, 43, "Project X", "title");
	["Plan", "Draft", "Review", "Publish"].forEach((label, i) => {
		text(34, 76 + i * 23, String(i + 1), "small");
		text(56, 76 + i * 23, label, "mono");
	});
	const band = group("gesture"); box(126, 63, 48, 84, "wash", band);
	const after = group("after");
	[76, 99, 122, 145].forEach((y) => text(130, y, "ready", "mono", after));
	const carets = group("carets");
	[76, 99, 122, 145].forEach((y) => path("M163 " + (y - 11) + " v14", "accent", carets));
	text(36, 169, t("demo.gesture"), "small");
}
