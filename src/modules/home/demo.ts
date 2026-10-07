// The scene of Home's card in the settings showcase (docs/showcase.md): the Home tab fills
// itself in, then the rounded cursor glides onto a domain and its notes unfold on the Map.
import { setIcon } from "obsidian";

const SVG = "http://www.w3.org/2000/svg";

/** Domains of the sample vault (hue, name), and the notes under the second one. */
const DOMAINS: [number, string][] = [
	[150, "Clients"],
	[262, "Projects"],
	[30, "Garden"],
];
const NOTES = ["Website", "Party", "Launch plan"];
const ROWS = [136, 159, 182];

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const root = el.createDiv({ cls: "sk-demo-home" });
	root.createDiv({ cls: "sk-demo-home-pane" });
	const stage = root.createDiv({ cls: "sk-demo-home-stage" });

	const tabs = stage.createDiv({ cls: "sk-demo-home-tabs" });
	const tab = (icon: string, label: string, on = false) => {
		const item = tabs.createSpan({ cls: "sk-demo-home-tab" + (on ? " is-on" : "") });
		setIcon(item.createSpan({ cls: "sk-demo-home-ico" }), icon);
		item.createSpan({ text: label });
	};
	tab("house", t("tab.label"), true);
	tab("list-checks", t("demo.tasks"));
	tab("zap", t("demo.brainstorms"));

	const search = stage.createDiv({ cls: "sk-demo-home-search" });
	setIcon(search.createSpan({ cls: "sk-demo-home-ico" }), "search");
	search.createSpan({ cls: "sk-demo-home-placeholder", text: t("search.placeholder") });

	stage.createDiv({ cls: "sk-demo-home-label", text: t("today.title") });
	const chips = stage.createDiv({ cls: "sk-demo-home-chips" });
	const chip = (icon: string, label: string, extra = "") => {
		const item = chips.createSpan({ cls: "sk-demo-home-chip " + extra });
		setIcon(item.createSpan({ cls: "sk-demo-home-ico" }), icon);
		item.createSpan({ text: label });
	};
	chip("sun", t("demo.daily"));
	chip("circle-dot", t("today.due.other").replace("{count}", "2"), "is-due");
	chip("plus", t("today.new-brainstorm"));

	const lens = stage.createDiv({ cls: "sk-demo-home-lens" });
	lens.createSpan({ cls: "is-on", text: t("lens.map") });
	lens.createSpan({ text: t("lens.domains") });
	lens.createSpan({ text: t("lens.tags") });

	// The Map: lines in an SVG drawn in the scene's own units (320 x 200), names in HTML on top.
	const map = stage.createDiv({ cls: "sk-demo-home-map" });
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 320 200");
	svg.setAttribute("preserveAspectRatio", "none");
	svg.classList.add("sk-demo-home-lines");
	map.appendChild(svg);
	const line = (y1: number, x1: number, x2: number, y2: number, cls: string) => {
		const path = document.createElementNS(SVG, "path");
		const mid = (x1 + x2) / 2;
		path.setAttribute("d", `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
		path.classList.add(cls);
		svg.appendChild(path);
	};
	ROWS.forEach((y) => line(159, 76, 104, y, "sk-demo-home-l1"));
	ROWS.forEach((y) => line(159, 178, 202, y, "sk-demo-home-l2"));

	const node = (x: number, y: number, cls: string) => {
		const item = map.createDiv({ cls: "sk-demo-home-node " + cls });
		item.style.left = `${x / 10}em`;
		item.style.top = `${y / 10 - 0.8}em`;
		return item;
	};
	const home = node(18, 159, "sk-demo-home-root");
	home.createSpan({ cls: "sk-demo-home-badge", text: "H" });
	home.createSpan({ text: "Home" });

	map.createDiv({ cls: "sk-demo-home-cursor" });
	DOMAINS.forEach(([hue, name], i) => {
		const item = node(108, ROWS[i], `sk-demo-home-domain sk-demo-home-d${i}`);
		item.setCssProps({ "--sk-hue": String(hue) });
		setIcon(item.createSpan({ cls: "sk-demo-home-ico" }), "git-fork");
		item.createSpan({ text: name });
	});
	NOTES.forEach((name, i) => {
		const item = node(206, ROWS[i], `sk-demo-home-note sk-demo-home-n${i}`);
		item.createSpan({ cls: "sk-demo-home-dot" });
		item.createSpan({ text: name });
	});
}
