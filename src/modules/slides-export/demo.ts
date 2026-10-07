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
	const group = (name: string, parent: Element = svg) => draw("g", { class: "sk-demo-slides-export-" + name }, parent);
	const box = (x: number, y: number, width: number, height: number, name = "paper", parent: Element = svg) => draw("rect", { x, y, width, height, rx: 4, class: "sk-demo-slides-export-" + name }, parent);
	const text = (x: number, y: number, value: string, name = "text", parent: Element = svg) => {
		const node = draw("text", { x, y, class: "sk-demo-slides-export-" + name }, parent);
		node.textContent = value;
		return node;
	};
	const path = (d: string, parent: Element) => draw("path", { d, class: "sk-demo-slides-export-ink" }, parent);
	box(12, 12, 162, 176, "canvas");
	text(24, 27, "Excalidraw", "heading");
	const drawing = (parent: Element, index: number) => {
		const shape = (kind: number, x: number) => {
			if (kind === 0) path("M" + x + " 15 h16 v16 h-16 Z", parent);
			else if (kind === 1) draw("circle", { cx: x + 8, cy: 23, r: 8, class: "sk-demo-slides-export-ink" }, parent);
			else path("M" + (x + 8) + " 13 l10 10 -10 10 -10 -10 Z", parent);
		};
		shape(index, 10); shape((index + 1) % 3, 54);
		path("M33 23 H46 m-4 -4 4 4 -4 4", parent);
	};
	// Frame and slide share the same drawing geometry and 16:9 proportions.
	for (let i = 0; i < 3; i++) {
		const sourceY = 36 + i * 50;
		const slideY = 24 + i * 52;
		text(30, sourceY + 27, String(i + 1), "number");
		const source = group("source");
		source.setAttribute("transform", "translate(58 " + sourceY + ")");
		box(0, 0, 80, 45, "frame", source); drawing(source, i);
		const slide = group("slide-" + i);
		text(201, slideY + 27, String(i + 1), "number", slide);
		const thumbnail = group("thumbnail", slide);
		thumbnail.setAttribute("transform", "translate(216 " + slideY + ")");
		box(0, 0, 80, 45, "sheet", thumbnail); drawing(thumbnail, i);
		const flight = group("flight-" + i);
		const picture = group("thumbnail", flight);
		picture.setAttribute("transform", "translate(58 " + sourceY + ")");
		box(0, 0, 80, 45, "sheet", picture); drawing(picture, i);
	}
	const chip = group("file");
	box(224, 179, 64, 16, "paper", chip);
	text(241, 191, ".pptx", "file-text", chip);
	// Localized accessible SVG title; the visible file extension needs no translation.
	const title = draw("title", {});
	title.textContent = t("demo.export");
}
