export type Registry = Record<string, number>;
export interface Hues { rootHue: number; leafHue: number }

const HASH_RE = /^#/;
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function tagKey(tag: string) {
	return String(tag).replace(HASH_RE, "").toLowerCase();
}

export function splitTag(tag: string) {
	const parts = String(tag).replace(HASH_RE, "").split("/");
	return { root: parts[0], mids: parts.slice(1, -1), leaf: parts[parts.length - 1], parts };
}

export function fnv1a(text: string) {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
	return hash >>> 0;
}

export function slotHue(slot: number) { return slot * 360 / 14 + 18; }

export function assignSlots(registry: Registry, tagsByFreq: Registry) {
	const result = { ...registry };
	const frequencies = new Map<string, number>();
	for (const [tag, count] of Object.entries(tagsByFreq)) {
		const key = tagKey(tag);
		if (key) frequencies.set(key, (frequencies.get(key) || 0) + count);
	}
	const explicit = new Set(frequencies.keys());
	// Implicit ancestors inherit the highest descendant frequency for ordering.
	for (const [key, count] of [...frequencies]) {
		const parts = key.split("/");
		for (let i = 1; i < parts.length; i++) {
			const parent = parts.slice(0, i).join("/");
			if (!explicit.has(parent)) frequencies.set(parent, Math.max(frequencies.get(parent) || 0, count));
		}
	}
	const ordered = [...frequencies.keys()].sort((a, b) => frequencies.get(b)! - frequencies.get(a)! || a.localeCompare(b));
	function assign(key: string) {
		if (has(result, key)) return;
		const parts = key.split("/");
		if (parts.length > 1) assign(parts.slice(0, -1).join("/"));
		// Family-wide avoidance also distinguishes cousins at different depths.
		const avoided = new Set(Object.keys(result)
			.filter(other => parts.length === 1 ? !other.includes("/") : other.split("/")[0] === parts[0])
			.map(other => result[other]));
		let slot = fnv1a(key) % 14;
		for (let i = 0; i < 14; i++, slot = (slot + 5) % 14) if (!avoided.has(slot)) break;
		Object.defineProperty(result, key, { value: slot, enumerable: true, writable: true, configurable: true });
	}
	for (const key of ordered.filter(key => !key.includes("/"))) assign(key);
	for (const key of ordered) assign(key);
	return result;
}

export function tagHues(tag: string, registry: Registry, overrides: Registry) {
	const key = tagKey(tag);
	const hue = (k: string) => has(overrides, k) ? overrides[k] : slotHue(has(registry, k) ? registry[k] : fnv1a(k) % 14);
	return { rootHue: hue(key.split("/")[0]), leafHue: hue(key) };
}

export function linearRgb(l: number, c: number, hue: number) {
	const angle = hue * Math.PI / 180;
	const a = c * Math.cos(angle), b = c * Math.sin(angle);
	const x = (l + .3963377774 * a + .2158037573 * b) ** 3;
	const y = (l - .1055613458 * a - .0638541728 * b) ** 3;
	const z = (l - .0894841775 * a - 1.291485548 * b) ** 3;
	return [4.0767416621 * x - 3.3077115913 * y + .2309699292 * z,
		-1.2684380046 * x + 2.6097574011 * y - .3413193965 * z,
		-.0041960863 * x - .7034186147 * y + 1.707614701 * z];
}

export function gamutChroma(l: number, c: number, hue: number) {
	const fits = (chroma: number) => linearRgb(l, chroma, hue).every(v => v >= 0 && v <= 1);
	if (fits(c)) return c;
	let low = 0, high = c;
	for (let i = 0; i < 30; i++) {
		const mid = (low + high) / 2;
		if (fits(mid)) low = mid; else high = mid;
	}
	return low;
}

export function oklchToSrgb(l: number, c: number, hue: number) {
	return linearRgb(l, gamutChroma(l, c, hue), hue).map(v => {
		v = Math.max(0, Math.min(1, v));
		return v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
	});
}

export function contrastRatio(first: number[], second: number[]) {
	const luminance = (rgb: number[]) => rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
		.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
	const a = luminance(first), b = luminance(second);
	return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export function roleColors(hue: number, theme: string, role: string) {
	const dark = theme === "dark", cap = role === "root";
	const bg: [number, number] = dark ? (cap ? [.38, .075] : [.29, .045]) : (cap ? [.89, .065] : [.955, .032]);
	const fg: [number, number] = dark ? (cap ? [.90, .07] : [.85, .085]) : (cap ? [.36, .12] : [.43, .11]);
	while (contrastRatio(oklchToSrgb(...bg, hue), oklchToSrgb(...fg, hue)) < 4.5 && fg[0] > 0 && fg[0] < 1) {
		fg[0] = Math.max(0, Math.min(1, fg[0] + (dark ? .005 : -.005)));
	}
	return { bg: [bg[0], gamutChroma(...bg, hue), hue], fg: [fg[0], gamutChroma(...fg, hue), hue] };
}

// Encode fractional palette hues without a dot in the CSS class name.
export function hueId(hue: number) { return String(hue).replace(/\./g, "_"); }
export function hueClasses(hues: Hues) { return `sk-tag-colors-r-${hueId(hues.rootHue)} sk-tag-colors-l-${hueId(hues.leafHue)}`; }

export function buildCss(hues: number[]) {
	const rules = [];
	for (const theme of ["light", "dark"]) {
		for (const hue of new Set(hues)) {
			for (const [prefix, role] of [["r", "root"], ["l", "leaf"]]) {
				const colors = roleColors(hue, theme, role);
				const css = (color: number[]) => `oklch(${color.join(" ")})`;
				rules.push(`body.theme-${theme} .sk-tag-colors-${prefix}-${hueId(hue)} { --sk-tag-${prefix}-bg: ${css(colors.bg)}; --sk-tag-${prefix}-fg: ${css(colors.fg)}; }`);
			}
		}
	}
	return rules.join("\n");
}

export function hexToHue(hex: string) {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Expected a six-digit hex color");
	const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
	const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
	const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
	const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
	const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
	const bb = .0259040371 * l + .7827717662 * m - .808675766 * s;
	return (Math.round(Math.atan2(bb, a) * 180 / Math.PI) + 360) % 360;
}

export function capsule(doc: Document, tag: string, classes: string) {
	const { root, parts } = splitTag(tag);
	const span = (className: string, text?: string) => {
		const el = doc.createElement("span");
		el.className = className;
		if (text != null) el.textContent = text;
		return el;
	};
	const el = span(`sk-tag-colors-tag ${parts.length > 1 ? "sk-tag-colors-nested " : ""}${classes}`);
	el.appendChild(span("sk-tag-colors-cap", root));
	if (parts.length > 1) {
		const body = span("sk-tag-colors-body");
		parts.slice(1).forEach((part, i) => {
			if (i) body.appendChild(span("sk-tag-colors-chev", "›"));
			body.appendChild(span(i === parts.length - 2 ? "sk-tag-colors-leaf" : "sk-tag-colors-mid", part));
		});
		el.appendChild(body);
	}
	return el;
}

