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
	const group = (name: string, parent: Element = svg) => draw("g", { class: "sk-demo-tables-" + name }, parent);
	const box = (x: number, y: number, width: number, height: number, name = "paper", parent: Element = svg) => draw("rect", { x, y, width, height, rx: 4, class: "sk-demo-tables-" + name }, parent);
	const text = (x: number, y: number, value: string, name = "text", parent: Element = svg) => {
		const node = draw("text", { x, y, class: "sk-demo-tables-" + name }, parent);
		node.textContent = value;
	};
	const path = (d: string, name = "line", parent: Element = svg) => draw("path", { d, class: "sk-demo-tables-" + name }, parent);
	box(18, 18, 284, 165);
	text(34, 42, "Project X", "title");
	const before = group("before");
	["| Task   | Days |", "| ------ | ---- |", "| Review |  12  |", "| Draft  |   2  |", "| Plan   |   1  |"].forEach((line, i) => text(38, 72 + i * 19, line, "mono", before));
	const after = group("after");
	box(34, 77, 252, 24, "wash", after);
	box(34, 123, 252, 23, "wash", after);
	text(44, 93, "Task", "text", after); text(234, 93, "Days ↑", "text", after);
	path("M34 101 H286", "accent", after);
	["Plan", "Draft", "Review"].forEach((label, i) => {
		const row = group("row-" + i, after);
		text(44, 117 + i * 23, label, "text", row);
		text(244, 117 + i * 23, ["1", "2", "12"][i], "text", row);
		path("M34 " + (123 + i * 23) + " H286", "line", after);
	});
	box(46, 49, 228, 22, "paper", after);
	["rows", "columns", "sort", "style"].forEach((key, i) => text(54 + i * 54, 63, t("demo." + key), "small", after));
	text(261, 63, "⋯", "small", after);
	const gesture = group("sort-gesture");
	box(149, 49, 52, 22, "wash", gesture);
	path("M183 67 l0 13 4 -4 5 1 Z", "accent", gesture);
}
