import { hueId, roleColors } from "./colors";

const SELECTOR = '[class*="sk-tag-colors-r-"], [class*="sk-tag-colors-l-"]';
const SCOPED = ".sk-tag-colors-settings, .sk-tag-colors-modal";

/** Keep the public hue classes, with theme colors supplied as variables instead of a stylesheet. */
export function watchPalette(root: HTMLElement, hues: number[]) {
	let palette = colorsFor(hues);
	const painted = new Map<HTMLElement, string[]>();
	const clear = (el: HTMLElement) => {
		for (const key of painted.get(el) ?? []) el.style.removeProperty(key);
		painted.delete(el);
	};
	const paint = (el: HTMLElement) => {
		// Settings and dialogs own their palettes, including while the module is off.
		if (root === root.ownerDocument.body && el.closest(SCOPED)) return;
		const props: Record<string, string> = {};
		for (const cls of Array.from(el.classList)) Object.assign(props, palette.get(cls));
		for (const key of painted.get(el) ?? []) if (!(key in props)) el.style.removeProperty(key);
		if (Object.keys(props).length) {
			el.setCssProps(props);
			painted.set(el, Object.keys(props));
		} else painted.delete(el);
	};
	const scan = (el: HTMLElement) => {
		if (el.matches(SELECTOR) || painted.has(el)) paint(el);
		for (const child of Array.from(el.querySelectorAll<HTMLElement>(SELECTOR))) paint(child);
	};
	const observer = new MutationObserver(records => {
		for (const record of records) {
			if (record.type === "attributes") paint(record.target as HTMLElement);
			else for (const node of Array.from(record.addedNodes)) {
				if (node.nodeType === 1) scan(node as HTMLElement);
			}
		}
		for (const el of painted.keys()) if (!root.contains(el)) clear(el);
	});
	observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
	scan(root);
	return {
		update(hues: number[]) {
			palette = colorsFor(hues);
			scan(root);
		},
		destroy() {
			observer.disconnect();
			for (const el of painted.keys()) clear(el);
		},
	};
}

function colorsFor(hues: number[]): Map<string, Record<string, string>> {
	const palette = new Map<string, Record<string, string>>();
	for (const hue of new Set(hues)) {
		for (const [prefix, role] of [["r", "root"], ["l", "leaf"]]) {
			const props: Record<string, string> = {};
			for (const theme of ["light", "dark"]) {
				const colors = roleColors(hue, theme, role);
				props[`--sk-tag-${prefix}-${theme}-bg`] = `oklch(${colors.bg.join(" ")})`;
				props[`--sk-tag-${prefix}-${theme}-fg`] = `oklch(${colors.fg.join(" ")})`;
			}
			palette.set(`sk-tag-colors-${prefix}-${hueId(hue)}`, props);
		}
	}
	return palette;
}
