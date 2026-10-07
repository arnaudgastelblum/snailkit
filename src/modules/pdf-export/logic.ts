// Pure helpers of the PDF export: markdown preparation, page geometry, link and image targets,
// CSS rule filtering and print options. No DOM, no app: all of it is tested in plain Node.
import { normalizePath } from "obsidian";
import type { PdfExportSettings } from "./types";

/** Class names shared by the render host (main window) and the printed page. */
export const CLS = {
	host: "sk-pdf-export-host",
	wrap: "sk-pdf-export-wrap",
	body: "sk-pdf-export",
	pageBreak: "sk-pdf-export-page-break",
	placeholder: "sk-pdf-export-placeholder",
	imageLink: "sk-pdf-export-image-link",
	canvas: "sk-pdf-export-canvas",
} as const;

/** CSS variable carrying the usable page width on the render host. */
export const WIDTH_VAR = "--sk-pdf-export-width";

/** Paper sizes in mm, portrait. The keys are the names Chromium's printToPDF accepts as `pageSize`. */
export const PAGE_SIZES_MM: Record<string, { width: number; height: number }> = {
	A3: { width: 297, height: 420 },
	A4: { width: 210, height: 297 },
	A5: { width: 148, height: 210 },
	Letter: { width: 215.9, height: 279.4 },
	Legal: { width: 215.9, height: 355.6 },
	Tabloid: { width: 279.4, height: 431.8 },
};

/** Marker line replacement: a block-level element the print CSS breaks before. */
export const PAGE_BREAK_HTML = `<div class="${CLS.pageBreak}"></div>`;

// Opening or closing "---" of a YAML frontmatter: column 0, trailing spaces ok.
const FRONTMATTER_FENCE_RE = /^---[ \t]*$/;
// Opening or closing line of a fenced code block.
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
// A level 1 heading, the title of a note.
const H1_RE = /^#\s/;
// Combining marks left by a NFD normalization (accents).
const DIACRITICS_RE = /[\u0300-\u036f]/g;
// Leading slash of a Windows path inside a URL: "/C:/Users/...".
const DRIVE_PREFIX_RE = /^\/+([A-Za-z]:)/;
// An already absolute path: "C:/..." or "/...".
const ABS_PATH_RE = /^(?:[A-Za-z]:\/|\/)/;
/** A media query that applies to print: dropped, it is what breaks the theme. */
export const PRINT_MEDIA_RE = /\bprint\b/i;
const EXTERNAL_URL_RE = /^https?:/i;
// Characters kept in the name of the temporary HTML file.
const TEMP_NAME_RE = /[^A-Za-z0-9._-]+/g;

export function clamp(value: unknown, min: number, max: number): number {
	const n = Number(value);
	if (!isFinite(n)) return min;
	return Math.min(max, Math.max(min, n));
}

/** Index of the closing "---" of the YAML frontmatter, -1 when there is none. */
export function frontmatterEnd(lines: string[]): number {
	if (!FRONTMATTER_FENCE_RE.test(lines[0] ?? "")) return -1;
	for (let i = 1; i < lines.length; i++) {
		// Column 0 only: an indented "---" (inside a YAML block scalar) does not close it.
		if (FRONTMATTER_FENCE_RE.test(lines[i])) return i;
	}
	return -1;
}

/**
 * The markdown handed to the renderer: no frontmatter (properties are not in the PDF), page
 * break markers turned into an element the print CSS knows, and the note name as a title when
 * the note has none.
 */
export function prepareMarkdown(
	markdown: string,
	noteName: string,
	options: Pick<PdfExportSettings, "pageBreakMarker" | "addTitle">,
): string {
	const marker = String(options.pageBreakMarker ?? "").trim();
	const lines = String(markdown ?? "").split(/\r?\n/);
	const close = frontmatterEnd(lines);
	const body = close === -1 ? lines : lines.slice(close + 1);

	const out: string[] = [];
	let inFence = false;
	for (const line of body) {
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		// A marker inside a code block is content, not an instruction.
		if (!inFence && marker && line.trim() === marker) {
			// Blank lines around it: an HTML block runs until the next blank line, so the text
			// right after it would stop being markdown.
			out.push("", PAGE_BREAK_HTML, "");
			continue;
		}
		out.push(line);
	}

	if (options.addTitle) {
		const first = out.find((line) => line.trim() !== "");
		if (!first || !H1_RE.test(first.trim())) out.unshift("# " + (noteName || ""), "");
	}
	return out.join("\n");
}

/** Heading anchor, same shape for the headings and the [[#Heading]] links that point at them. */
export function slugify(text: string | null | undefined): string {
	return String(text ?? "")
		.normalize("NFD")
		.replace(DIACRITICS_RE, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** printToPDF wants inches. */
export function mmToInches(mm: number): number {
	return clamp(mm, 0, 1000) / 25.4;
}

/** Paper size in mm, orientation applied. */
export function pageSizeMm(pageSize: string, landscape: boolean): { width: number; height: number } {
	const size = PAGE_SIZES_MM[pageSize] ?? PAGE_SIZES_MM.A4;
	return landscape ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/**
 * Usable page width in CSS pixels (96 dpi). The render host gets this width, so Mermaid,
 * Charts and tables lay themselves out as on paper.
 */
export function contentWidthPx(pageSize: string, landscape: boolean, marginMm: number): number {
	const size = pageSizeMm(pageSize, landscape);
	const inner = size.width - 2 * clamp(marginMm, 0, 40);
	return Math.max(100, Math.round((inner * 96) / 25.4));
}

/** Deep link that opens a vault file in Obsidian. Notes lose their ".md": that is the path Obsidian expects. */
export function obsidianUri(vaultName: string, filePath: string): string {
	const path = String(filePath ?? "");
	const target = path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
	return "obsidian://open?vault=" + encodeURIComponent(vaultName || "") + "&file=" + encodeURIComponent(target);
}

/**
 * The file part of a link target: no "#heading" or "#^block", no "|alias" (an image embed keeps
 * its display size there). That is all getFirstLinkpathDest understands.
 */
export function linkTarget(raw: string | null | undefined): string {
	return String(raw ?? "").split("#")[0].split("|")[0].trim();
}

function trimBase(basePath: string): string {
	return String(basePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Absolute path (with "/" separators) behind an "app://" URL, null when the URL is not one.
 * Obsidian serves vault files as "app://<hash>/C:/Users/x/Vault/img.png?<mtime>".
 */
export function appUrlPath(src: string, basePath: string): string | null {
	const raw = String(src ?? "");
	if (!raw.startsWith("app://")) return null;
	let path: string;
	try {
		path = decodeURIComponent(new URL(raw).pathname);
	} catch {
		return null;
	}
	// On Windows the pathname carries a leading slash before the drive letter.
	path = path.replace(/\\/g, "/").replace(DRIVE_PREFIX_RE, "$1");
	if (!ABS_PATH_RE.test(path)) {
		// Some builds serve a vault-relative path: rebuild it from the root.
		const base = trimBase(basePath);
		if (!base) return null;
		path = base + "/" + path.replace(/^\/+/, "");
	}
	return path;
}

/** "app://..." to the file:// URL the print page (itself loaded from file://) can read. */
export function appUrlToFileUrl(src: string, basePath: string): string | null {
	const path = appUrlPath(src, basePath);
	if (!path) return null;
	// encodeURI, not encodeURIComponent: the slashes must survive. "#" and "?" are the two
	// characters encodeURI leaves alone but a URL path cannot keep.
	const encoded = encodeURI(path.replace(/^\/+/, "")).replace(/#/g, "%23").replace(/\?/g, "%3F");
	return "file:///" + encoded;
}

/** Vault-relative path of a file served through "app://", null when it sits outside the vault. */
export function appUrlToVaultPath(src: string, basePath: string): string | null {
	const path = appUrlPath(src, basePath);
	const base = trimBase(basePath);
	if (!path || !base) return null;
	// Windows paths are case-insensitive: compare in lowercase.
	if (!path.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
	return path.slice(base.length + 1);
}

/** What the snapshot needs to know about the vault to rewrite links. */
export interface LinkContext {
	basePath: string;
	vaultName: string;
	internalLinks: string;
	/** Vault path of a link target, null when it resolves to nothing. */
	resolve(linkpath: string): string | null;
}

/**
 * New href of an internal link (`data-href` or `href`), null to remove it. Links to a heading of
 * the same note stay inside the document, block references and unresolved links lose their target.
 */
export function internalLinkHref(raw: string, ctx: LinkContext): string | null {
	if (ctx.internalLinks === "none") return null;
	const hash = raw.indexOf("#");
	const target = hash === -1 ? raw : raw.slice(0, hash);
	const sub = hash === -1 ? "" : raw.slice(hash + 1);
	// A block reference has no destination in the PDF.
	if (sub.startsWith("^")) return null;
	// [[#Heading]]: same slug as the headings of the document.
	if (!target) return sub ? "#" + slugify(sub) : null;
	const dest = ctx.resolve(target);
	return dest ? obsidianUri(ctx.vaultName, dest) : null;
}

/**
 * Link target of an image: the vault file it shows (from the embed's `src`, else from its
 * app:// URL), else its web URL. Null when unresolved: no link rather than a dead one.
 */
export function imageHref(embedSrc: string, imgSrc: string, ctx: LinkContext): string | null {
	const dest = (embedSrc && ctx.resolve(embedSrc)) || appUrlToVaultPath(imgSrc, ctx.basePath);
	if (dest) return obsidianUri(ctx.vaultName, dest);
	return EXTERNAL_URL_RE.test(imgSrc) ? imgSrc : null;
}

/** Label and link of the paragraph that replaces an unprintable embed (PDF, video, audio, iframe). */
export function placeholderFor(embedSrc: string, rawSrc: string, tagName: string, ctx: LinkContext): { label: string; href: string | null } {
	const dest = embedSrc ? ctx.resolve(embedSrc) : null;
	const label = embedSrc || fileNameOf(rawSrc) || tagName.toLowerCase();
	let href: string | null = null;
	if (dest) href = obsidianUri(ctx.vaultName, dest);
	else if (EXTERNAL_URL_RE.test(rawSrc)) href = rawSrc;
	return { label, href };
}

/** The parts of a CSSRule the filter looks at. Duck typed on purpose (no CSSMediaRule in Node). */
export interface RuleLike {
	type?: number;
	cssText?: string;
	conditionText?: string;
	media?: { mediaText?: string };
	cssRules?: ArrayLike<{ cssText?: string } | null>;
}

function looksLikeMediaRule(rule: RuleLike): boolean {
	if (rule.type === 4) return true;
	if (rule.constructor?.name === "CSSMediaRule") return true;
	// On cssText, not on conditionText: @supports, @container and @layer expose a conditionText
	// too, and their cssText must pass through intact (a condition like "(print-color-adjust:
	// exact)" would look like a print media query).
	return /^\s*@media\b/i.test(rule.cssText || "");
}

function looksLikePageRule(rule: RuleLike): boolean {
	if (rule.type === 6) return true;
	if (rule.constructor?.name === "CSSPageRule") return true;
	return /^\s*@page\b/.test(rule.cssText || "");
}

function mediaCondition(rule: RuleLike): string {
	if (typeof rule.conditionText === "string") return rule.conditionText;
	if (typeof rule.media?.mediaText === "string") return rule.media.mediaText;
	return "";
}

function innerCssText(rule: RuleLike): string {
	return Array.from(rule.cssRules ?? [])
		.map((inner) => inner?.cssText || "")
		.filter(Boolean)
		.join("\n");
}

/** One collected style sheet rule: the CSS to emit, or null when the rule is dropped. */
export function filterCssRule(rule: RuleLike | null | undefined): string | null {
	if (!rule) return null;
	if (looksLikeMediaRule(rule)) {
		const condition = mediaCondition(rule);
		// Print styles are exactly what the native export gets wrong.
		if (PRINT_MEDIA_RE.test(condition)) return null;
		// The print engine evaluates the "print" media, so screen-only rules would be lost:
		// emit them without their wrapper.
		if (condition.trim().toLowerCase() === "screen") return innerCssText(rule);
		return rule.cssText || "";
	}
	// @page: the margins come from the print options, an @page would fight them.
	if (looksLikePageRule(rule)) return null;
	return rule.cssText || "";
}

/**
 * Body classes of the printed page: they carry the theme, the Style Settings choices and the
 * font size. theme-light / theme-dark carry the color scheme, so a forced scheme keeps exactly one.
 */
export function bodyClassList(classes: string, colorScheme: string): string {
	let list = String(classes || "")
		.split(/\s+/)
		.filter(Boolean)
		// A translucent window paints a transparent body: on paper that beats the theme background.
		.filter((name) => name !== "is-translucent");
	if (colorScheme === "light" || colorScheme === "dark") {
		list = list.filter((name) => name !== "theme-light" && name !== "theme-dark");
		list.push("theme-" + colorScheme);
	}
	if (!list.includes(CLS.body)) list.push(CLS.body);
	return list.join(" ");
}

/** Automatic page break before each heading of that level and above, the first block excepted. */
export function pageBreakCss(pageBreakBefore: string): string {
	const levels = pageBreakBefore === "h1" ? ["h1"] : pageBreakBefore === "h2" ? ["h1", "h2"] : [];
	if (!levels.length) return "";
	// Two shapes per level: the renderer may wrap each block in a div (reading view sections)
	// or put the heading straight in the sizer.
	const selectors: string[] = [];
	for (const h of levels) {
		selectors.push(".markdown-preview-sizer > div:not(:first-child) > " + h);
		selectors.push(".markdown-preview-sizer > " + h + ":not(:first-child)");
	}
	return selectors.join(",\n") + " { break-before: page; }";
}

/** The scheme the page will actually carry, not only the setting. */
export function isDarkScheme(colorScheme: string, bodyIsDark: boolean): boolean {
	return colorScheme === "dark" || (colorScheme !== "light" && bodyIsDark);
}

/**
 * Page background: paper white, or the theme's own color. A dark scheme keeps its background
 * whatever the setting says: light text on a white page would be unreadable.
 */
export function backgroundCss(pageBackground: string, darkScheme: boolean): string {
	if (pageBackground !== "white" || darkScheme) return "";
	return "body { background-color: #ffffff !important; }";
}

export function escapeHtml(value: string | null | undefined): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** A rule text closing the style element would end the sheet early. */
export function safeStyleText(text: string): string {
	return String(text || "").replace(/<\/style>/gi, "<\\/style>");
}

/** File name at the end of a URL or a path, without its query. */
export function fileNameOf(url: string | null | undefined): string {
	const raw = String(url ?? "").split(/[?#]/)[0];
	let clean = raw;
	try {
		clean = decodeURIComponent(raw);
	} catch {
		// Malformed escape: the raw name is good enough for a label.
	}
	return clean.split(/[\\/]/).pop() || "";
}

/**
 * A Node Buffer is a view into a shared pool: slice exactly its own bytes before handing it to
 * the Vault API, which wants an ArrayBuffer.
 */
export function toArrayBuffer(buf: unknown): ArrayBuffer {
	if (!buf) return new ArrayBuffer(0);
	if (buf instanceof ArrayBuffer) return buf;
	const view = buf as { buffer?: unknown; byteOffset?: number; byteLength?: number; data?: unknown };
	if (view.buffer instanceof ArrayBuffer) {
		const start = view.byteOffset || 0;
		return view.buffer.slice(start, start + (view.byteLength ?? 0));
	}
	// { type: "Buffer", data: [...] }: the shape a JSON round trip through the bridge leaves.
	if (Array.isArray(view.data)) return new Uint8Array(view.data as number[]).buffer;
	return new ArrayBuffer(0);
}

/** CSS size of a canvas, its bitmap size as a fallback. Duck typed, testable without a DOM. */
export function canvasSize(canvas: { clientWidth?: number; clientHeight?: number; getAttribute?(name: string): string | null }): { width: number; height: number } {
	const attr = (name: string) => Number(canvas.getAttribute?.(name) || 0);
	const width = Number(canvas.clientWidth) || attr("width") || 0;
	const height = Number(canvas.clientHeight) || attr("height") || 0;
	return { width: Math.round(width), height: Math.round(height) };
}

/** Thrown when the module is turned off in the middle of an export. */
export class ExportCancelled extends Error {
	constructor() {
		super("Export cancelled");
		this.name = "ExportCancelled";
	}
}

/**
 * Every await on Electron or on the renderers gets a deadline (a stuck window must never leave
 * the export hanging) and stops at once when the export is cancelled. `ms` 0: no deadline (a
 * dialog waiting for the user), still cancellable.
 */
export function withTimeout<T>(promise: Promise<T> | T, ms: number, label: string, signal?: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new ExportCancelled());
			return;
		}
		const onAbort = () => {
			if (timer !== null) window.clearTimeout(timer);
			reject(new ExportCancelled());
		};
		const timer =
			ms > 0
				? window.setTimeout(() => {
						signal?.removeEventListener("abort", onAbort);
						reject(new Error(label + " timed out"));
					}, ms)
				: null;
		signal?.addEventListener("abort", onAbort, { once: true });
		Promise.resolve(promise).then(
			(value) => {
				if (timer !== null) window.clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				if (timer !== null) window.clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/** Vault folder of a folder setting: "" is the vault root. */
export function folderPath(value: string): string {
	const trimmed = String(value ?? "").trim();
	if (!trimmed || trimmed === "/") return "";
	return normalizePath(trimmed).replace(/^\/+|\/+$/g, "");
}

/** Vault path of the PDF of a note in a folder ("" = root). */
export function vaultPdfPath(folder: string, basename: string): string {
	const name = basename + ".pdf";
	return folder ? folder + "/" + name : name;
}

/** Name of the temporary HTML file: only safe characters, unique per export. */
export function tempHtmlName(basename: string, now: number): string {
	return (basename || "note").replace(TEMP_NAME_RE, "_") + "-" + now + ".html";
}

// Chromium header and footer templates: the pageNumber, totalPages and title spans are filled
// in by the print engine.
export const FOOTER_TEMPLATE =
	'<div style="font-size:9px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>';
export const HEADER_TEMPLATE =
	'<div style="font-size:9px;width:100%;text-align:center;color:#888"><span class="title"></span></div>';
// An empty string would bring back Chromium's own default template.
export const EMPTY_TEMPLATE = "<div></div>";

/** Options of Electron's printToPDF. */
export interface PrintOptions {
	landscape: boolean;
	printBackground: boolean;
	pageSize: string;
	scale: number;
	margins: { top: number; bottom: number; left: number; right: number };
	displayHeaderFooter: boolean;
	headerTemplate: string;
	footerTemplate: string;
	preferCSSPageSize: boolean;
	generateDocumentOutline: boolean;
}

export function printOptions(settings: PdfExportSettings): PrintOptions {
	const header = !!settings.headerTitle;
	const footer = !!settings.pageNumbers;
	const sideMm = clamp(settings.marginMm, 0, 40);
	// Chromium draws the header and footer inside the margins: too small a margin and they sit
	// on top of the text.
	const vertMm = header || footer ? Math.max(sideMm, 12) : sideMm;
	return {
		landscape: !!settings.landscape,
		printBackground: true,
		pageSize: PAGE_SIZES_MM[settings.pageSize] ? settings.pageSize : "A4",
		scale: clamp(settings.scalePercent, 50, 150) / 100,
		margins: { top: mmToInches(vertMm), bottom: mmToInches(vertMm), left: mmToInches(sideMm), right: mmToInches(sideMm) },
		displayHeaderFooter: header || footer,
		headerTemplate: header ? HEADER_TEMPLATE : EMPTY_TEMPLATE,
		footerTemplate: footer ? FOOTER_TEMPLATE : EMPTY_TEMPLATE,
		preferCSSPageSize: false,
		generateDocumentOutline: !!settings.outline,
	};
}
