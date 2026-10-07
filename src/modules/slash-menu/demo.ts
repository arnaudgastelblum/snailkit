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
	const group = (name: string, parent: Element = svg) => draw("g", { class: "sk-demo-slash-menu-" + name }, parent);
	const box = (x: number, y: number, width: number, height: number, name = "paper", parent: Element = svg) => draw("rect", { x, y, width, height, rx: 4, class: "sk-demo-slash-menu-" + name }, parent);
	const text = (x: number, y: number, value: string, name = "text", parent: Element = svg) => {
		const node = draw("text", { x, y, class: "sk-demo-slash-menu-" + name }, parent);
		node.textContent = value;
	};
	const path = (d: string, name = "line", parent: Element = svg) => draw("path", { d, class: "sk-demo-slash-menu-" + name }, parent);
	box(18, 18, 284, 165); text(36, 43, "Meeting notes", "title");
	box(36, 55, 219, 3, "bar"); box(36, 64, 172, 3, "bar");
	const before = group("before"); text(36, 86, "/", "mono", before);
	const query = group("query", before); text(43, 86, t("demo.query"), "mono", query);
	const menu = group("gesture"); box(35, 92, 219, 80, "paper", menu);
	text(47, 106, "/", "link", menu);
	const search = group("query", menu); text(60, 106, t("demo.query"), "small", search);
	box(41, 112, 207, 34, "wash", menu); path("M42 119 V139", "accent", menu);
	box(51, 117, 10, 10, "paper", menu); path("M53 122 l2 2 4 -5", "accent", menu);
	text(70, 126, t("demo.task"), "text", menu);
	text(70, 139, t("demo.task-desc"), "small", menu);
	text(47, 160, t("demo.select"), "small", menu);
	const unfiltered = group("unfiltered", menu);
	box(40, 111, 209, 42, "paper", unfiltered);
	text(51, 126, t("demo.heading"), "text", unfiltered);
	text(51, 143, t("demo.task"), "text", unfiltered);
	const after = group("after"); box(36, 82, 11, 11, "paper", after);
	text(55, 92, "Review the draft", "text", after);
	path("M133 81 V94", "accent", after);
	box(36, 108, 225, 3, "bar", after); box(36, 118, 182, 3, "bar", after);
}
