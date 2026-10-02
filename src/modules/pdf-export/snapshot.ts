// DOM side of the export: wait for the renderers, then turn the rendered note into one
// standalone HTML page. Everything happens on a clone: the live render host is never touched.
import {
	CLS,
	PRINT_MEDIA_RE,
	appUrlToFileUrl,
	bodyClassList,
	canvasSize,
	escapeHtml,
	filterCssRule,
	imageHref,
	internalLinkHref,
	placeholderFor,
	safeStyleText,
	slugify,
	type LinkContext,
	type RuleLike,
} from "./logic";
import { PRINT_CSS } from "./print-css";

// Obsidian's reading view lives deep inside the app containers, and themes select on that
// chain. The printed page rebuilds a minimal copy of it.
const WRAP_CHAIN: Array<{ cls: string; attrs?: Record<string, string> }> = [
	{ cls: "app-container" },
	{ cls: "horizontal-main-container" },
	{ cls: "workspace" },
	{ cls: "workspace-split mod-vertical mod-root" },
	{ cls: "workspace-leaf mod-active" },
	{ cls: "workspace-leaf-content", attrs: { "data-type": "markdown", "data-mode": "preview" } },
	{ cls: "view-content" },
	{ cls: "markdown-reading-view" },
];

// Classes of a reading view, used when no reading view is open to copy from.
const DEFAULT_PREVIEW_CLASSES =
	"markdown-preview-view markdown-rendered node-insert-event allow-fold-headings allow-fold-lists show-properties";

// Elements the print engine cannot draw: they become a link instead. A canvas only reaches this
// pass when its bitmap could not be read (see copyLiveState).
const UNPRINTABLE_SELECTOR = ".pdf-embed, video, audio, iframe, canvas";

// Quiet period without a DOM mutation that ends the wait for the renderers. Dataview and similar
// plugins render in bursts: a short window would cut a query that starts late.
const RENDER_QUIET_MS = 800;

/** Everything the snapshot needs besides the rendered DOM. */
export interface SnapshotContext extends LinkContext {
	title: string;
	colorScheme: string;
	clickableImages: boolean;
	/** Page break and background rules, appended after the print CSS. */
	extraCss: string;
}

/**
 * Resolves when the renderers are done: no DOM mutation for RENDER_QUIET_MS and every image
 * settled. Resolves false at the timeout, which is not an error: what is there gets exported.
 * Resolves false at once when the export is cancelled.
 */
export function waitForRender(host: HTMLElement, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		let done = false;
		let quietTimer = 0;
		const imagesPending = () =>
			Array.from(host.querySelectorAll("img")).some((img) => img.getAttribute("src") && !img.complete);

		const armQuiet = () => {
			if (done) return;
			window.clearTimeout(quietTimer);
			quietTimer = window.setTimeout(settle, RENDER_QUIET_MS);
		};
		const settle = () => {
			// Still loading: wait for the next image event or mutation.
			if (imagesPending()) armQuiet();
			else finish(true);
		};
		const observer = new MutationObserver(armQuiet);
		const hardTimer = window.setTimeout(() => finish(false), timeoutMs);
		const onAbort = () => finish(false);
		function finish(settled: boolean) {
			if (done) return;
			done = true;
			observer.disconnect();
			window.clearTimeout(quietTimer);
			window.clearTimeout(hardTimer);
			host.removeEventListener("load", armQuiet, true);
			host.removeEventListener("error", armQuiet, true);
			signal.removeEventListener("abort", onAbort);
			resolve(settled);
		}

		if (signal.aborted) return finish(false);
		signal.addEventListener("abort", onAbort, { once: true });
		observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
		// Image events do not bubble: listen in the capture phase.
		host.addEventListener("load", armQuiet, true);
		host.addEventListener("error", armQuiet, true);
		armQuiet();
	});
}

/**
 * All the CSS of the app, in order (app.css, theme, snippets, plugins, Style Settings), rule by
 * rule so the print media rules can be dropped.
 */
export function collectCss(doc: Document): string {
	const out: string[] = [];
	const seen = new Set<CSSStyleSheet>();
	const walk = (sheet: CSSStyleSheet | null) => {
		if (!sheet || seen.has(sheet)) return;
		seen.add(sheet);
		let rules: CSSRuleList | null = null;
		try {
			rules = sheet.cssRules;
		} catch {
			// Cross origin sheet: not readable, nothing we can do about it.
			return;
		}
		if (!rules) return;
		for (const rule of Array.from(rules)) {
			// @import: follow the imported sheet in place, order preserved. An import for the
			// print media brings in what breaks the theme.
			const imported = rule as CSSImportRule;
			if (imported.styleSheet) {
				if (!PRINT_MEDIA_RE.test(imported.media?.mediaText || "")) walk(imported.styleSheet);
				continue;
			}
			const css = filterCssRule(rule as unknown as RuleLike);
			if (css) out.push(css);
		}
	};
	for (const sheet of Array.from(doc.styleSheets)) walk(sheet);
	return out.join("\n");
}

/**
 * cloneNode copies the markup, not what a script drew or set: a canvas bitmap (charts, any
 * plugin that paints) and a checkbox state live outside the attributes, and no plugin script
 * runs in the print window. Both trees come from the same deep clone, so the nth element of one
 * is the nth element of the other.
 */
export function copyLiveState(live: HTMLElement, clone: HTMLElement): void {
	const doc = clone.ownerDocument;
	const liveCanvas = Array.from(live.querySelectorAll("canvas"));
	const cloneCanvas = Array.from(clone.querySelectorAll("canvas"));
	for (let i = 0; i < cloneCanvas.length && i < liveCanvas.length; i++) {
		const target = cloneCanvas[i];
		if (!target.parentNode) continue;
		let data = "";
		try {
			data = liveCanvas[i].toDataURL("image/png");
		} catch {
			// Tainted canvas (a cross origin image was drawn into it): the unprintable pass
			// makes it a link.
			continue;
		}
		// A canvas with no surface answers "data:,": nothing to show.
		if (!data || !data.startsWith("data:image/")) continue;
		const size = canvasSize(liveCanvas[i]);
		const img = doc.createElement("img");
		img.className = CLS.canvas;
		img.setAttribute("src", data);
		// The CSS size, not the bitmap size: a chart drawn at devicePixelRatio 2 would print
		// twice as large.
		if (size.width) img.setAttribute("width", String(size.width));
		if (size.height) img.setAttribute("height", String(size.height));
		target.parentNode.replaceChild(img, target);
	}

	const liveInputs = Array.from(live.querySelectorAll("input"));
	const cloneInputs = Array.from(clone.querySelectorAll("input"));
	for (let i = 0; i < cloneInputs.length && i < liveInputs.length; i++) {
		const type = String(liveInputs[i].type || "").toLowerCase();
		if (type !== "checkbox" && type !== "radio") continue;
		// Task list checkboxes: the renderer sets the property, outerHTML only serializes attributes.
		if (liveInputs[i].checked) cloneInputs[i].setAttribute("checked", "");
		else cloneInputs[i].removeAttribute("checked");
	}
}

/** Gives every heading an anchor, so [[#Heading]] links have a destination. */
function fixHeadings(root: HTMLElement): void {
	for (const h of Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
		if (h.id) continue;
		const slug = slugify(h.getAttribute("data-heading") || h.textContent || "");
		if (slug) h.id = slug;
	}
}

/** Wraps each image in a link, so a click in the PDF opens the file (an Excalidraw preview opens the drawing) or the web page. */
function linkImages(root: HTMLElement, ctx: SnapshotContext): void {
	const doc = root.ownerDocument;
	for (const img of Array.from(root.querySelectorAll("img"))) {
		if (img.closest("a") || !img.parentNode) continue;
		const embed = img.closest(".internal-embed");
		const href = imageHref(embed?.getAttribute("src") || "", img.getAttribute("src") || "", ctx);
		if (!href) continue;
		const a = doc.createElement("a");
		a.className = CLS.imageLink;
		a.setAttribute("href", href);
		img.parentNode.insertBefore(a, img);
		a.appendChild(img);
	}
}

/** Vault images travel as file:// URLs. data: (Excalidraw SVG, Mermaid) and http(s) are left as they are. */
function fixImages(root: HTMLElement, basePath: string): void {
	for (const img of Array.from(root.querySelectorAll("img"))) {
		img.removeAttribute("srcset");
		// Lazy images may never enter a viewport in the print window.
		img.removeAttribute("loading");
		const url = appUrlToFileUrl(img.getAttribute("src") || "", basePath);
		if (url) img.setAttribute("src", url);
	}
}

/** PDF, video, audio and iframe embeds cannot be printed: they become a link. */
function fixEmbeds(root: HTMLElement, ctx: SnapshotContext): void {
	const doc = root.ownerDocument;
	for (const el of Array.from(root.querySelectorAll(UNPRINTABLE_SELECTOR))) {
		// The whole embed becomes the link, except for a note embed: that one prints fine, only
		// the unprintable element inside it goes away.
		const embed = el.closest(".internal-embed:not(.markdown-embed)");
		const target = embed && embed !== root ? embed : el;
		if (!target.parentNode) continue;
		const withSrc = el.getAttribute("src") ? el : el.querySelector("[src]");
		const { label, href } = placeholderFor(embed?.getAttribute("src") || "", withSrc?.getAttribute("src") || "", el.tagName, ctx);
		const p = doc.createElement("p");
		p.className = CLS.placeholder;
		if (href) {
			const a = doc.createElement("a");
			a.setAttribute("href", href);
			a.textContent = label;
			p.appendChild(a);
		} else {
			p.textContent = label;
		}
		target.parentNode.replaceChild(p, target);
	}
}

/** Internal links open Obsidian, links to a heading of the same note stay inside the document, tags lose their target. */
function fixLinks(root: HTMLElement, ctx: SnapshotContext): void {
	for (const a of Array.from(root.querySelectorAll("a"))) {
		// A target attribute means nothing in a PDF.
		a.removeAttribute("target");
		if (a.classList.contains("tag")) {
			a.removeAttribute("href");
			continue;
		}
		if (!a.classList.contains("internal-link")) continue;
		const href = internalLinkHref(a.getAttribute("data-href") || a.getAttribute("href") || "", ctx);
		if (href) a.setAttribute("href", href);
		else a.removeAttribute("href");
	}
}

/** A PDF does not unfold: collapsed callouts and details are opened. */
function expandCollapsed(root: HTMLElement): void {
	for (const el of Array.from(root.querySelectorAll(".callout.is-collapsed"))) el.classList.remove("is-collapsed");
	for (const el of Array.from(root.querySelectorAll("details"))) el.setAttribute("open", "");
}

/** Classes of an open reading view, so the theme selectors apply. The render host is skipped. */
function readingViewClasses(doc: Document): string[] {
	const live = Array.from(doc.querySelectorAll(".markdown-preview-view")).find((el) => !el.closest("." + CLS.host));
	const classes = live ? Array.from(live.classList) : DEFAULT_PREVIEW_CLASSES.split(" ");
	// is-readable-line-width would cap the text width: the page already does.
	return classes.filter((name) => name && name !== "is-readable-line-width");
}

/** The standalone HTML document handed to the print window. */
function buildHtml(clone: HTMLElement, css: string, ctx: SnapshotContext, doc: Document): string {
	let outer: HTMLElement | null = null;
	let inner: HTMLElement | null = null;
	for (const step of WRAP_CHAIN) {
		const el = clone.ownerDocument.createElement("div");
		el.className = step.cls + " " + CLS.wrap;
		for (const [key, value] of Object.entries(step.attrs ?? {})) el.setAttribute(key, value);
		if (inner) inner.appendChild(el);
		else outer = el;
		inner = el;
	}
	inner!.appendChild(clone);

	const bodyClass = bodyClassList(doc.body.className, ctx.colorScheme);
	const bodyStyle = doc.body.getAttribute("style") || "";
	// The root can carry inline custom properties too (zoom, font size).
	const htmlStyle = doc.documentElement.getAttribute("style") || "";
	return [
		"<!DOCTYPE html>",
		`<html class="${escapeHtml(doc.documentElement.className)}"${htmlStyle ? ` style="${escapeHtml(htmlStyle)}"` : ""}>`,
		"<head>",
		'<meta charset="utf-8">',
		`<title>${escapeHtml(ctx.title)}</title>`,
		"<style>\n" + safeStyleText(css) + "\n</style>",
		"<style>\n" + safeStyleText(PRINT_CSS + "\n" + ctx.extraCss) + "\n</style>",
		"</head>",
		`<body class="${escapeHtml(bodyClass)}"${bodyStyle ? ` style="${escapeHtml(bodyStyle)}"` : ""}>`,
		outer!.outerHTML,
		"</body>",
		"</html>",
		"",
	].join("\n");
}

/** The rendered preview view (still live in the host) turned into the HTML page to print. */
export function snapshot(view: HTMLElement, ctx: SnapshotContext, doc: Document): string {
	const clone = view.cloneNode(true) as HTMLElement;
	// First, while the live nodes are still there: a canvas bitmap and a checkbox state do not
	// survive cloneNode.
	copyLiveState(view, clone);
	fixHeadings(clone);
	// Before fixImages: the vault file is resolved from the app:// path.
	if (ctx.clickableImages) linkImages(clone, ctx);
	fixImages(clone, ctx.basePath);
	fixEmbeds(clone, ctx);
	fixLinks(clone, ctx);
	expandCollapsed(clone);

	for (const name of readingViewClasses(doc)) clone.classList.add(name);
	clone.classList.add(CLS.wrap);
	clone.querySelector(".markdown-preview-sizer")?.classList.add(CLS.wrap);
	return buildHtml(clone, collectCss(doc), ctx, doc);
}
