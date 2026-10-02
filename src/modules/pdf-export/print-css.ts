// What travels with the printed page: the CSS injected after the collected styles, and the
// script that waits for fonts and images before printing.
import { CLS } from "./logic";

/**
 * Injected last in the printed page: it fights the app layout (absolute positioning,
 * full-height scroll containers) that would clip the PDF to one page, and sets pagination.
 */
export const PRINT_CSS = `
html, body {
	height: auto !important;
	min-height: 0 !important;
	overflow: visible !important;
	margin: 0 !important;
	padding: 0 !important;
	/* app.css sets body { contain: strict }: size containment makes the body 0 px tall and
	   paint containment clips everything in it, a blank PDF. Obsidian's own print stylesheet
	   lifts it the same way. */
	contain: none !important;
	position: static !important;
	transform: none !important;
}
body {
	background-color: var(--background-primary);
	-webkit-print-color-adjust: exact;
	print-color-adjust: exact;
}
.${CLS.wrap} {
	position: static !important;
	display: block !important;
	height: auto !important;
	min-height: 0 !important;
	max-height: none !important;
	width: auto !important;
	max-width: none !important;
	overflow: visible !important;
	margin: 0 !important;
	padding: 0 !important;
	flex: none !important;
	contain: none !important;
	transform: none !important;
	/* Themes dress the panes as cards (a 1px border and a tinted background on the leaf
	   content and on the preview view). On paper that is a frame around the note: the
	   wrappers carry no decoration, the page background belongs to the body alone. */
	border: 0 !important;
	border-radius: 0 !important;
	box-shadow: none !important;
	outline: 0 !important;
	background: transparent !important;
}
.markdown-preview-sizer.${CLS.wrap} {
	width: 100% !important;
	padding-bottom: 0 !important;
}
.collapse-indicator,
.heading-collapse-indicator,
.list-collapse-indicator,
.edit-block-button,
.markdown-embed-link,
.copy-code-button,
.callout-fold {
	display: none !important;
}
pre,
.callout,
table,
.math-block,
.excalidraw-svg,
.internal-embed.image-embed,
figure,
.${CLS.placeholder},
tr {
	break-inside: avoid;
}
h1, h2, h3, h4, h5, h6 {
	break-after: avoid;
}
.${CLS.pageBreak} {
	break-before: page;
	height: 0;
	margin: 0;
}
pre,
pre > code {
	white-space: pre-wrap;
	overflow: visible;
	word-break: break-word;
}
img {
	max-width: 100%;
	height: auto;
}
.${CLS.imageLink} {
	display: inline-block;
	text-decoration: none;
}
`;

/**
 * Evaluated in the print window before printing: fonts and images must be in place, or the PDF
 * shows fallback glyphs and empty boxes. 5 s ceiling, a missing image is not worth a failed export.
 */
export const READY_SCRIPT = `(function () {
	return new Promise(function (resolve) {
		var timer = setTimeout(function () { resolve(false); }, 5000);
		var finish = function () { clearTimeout(timer); resolve(true); };
		var waitFonts = function () {
			var fonts = document.fonts && document.fonts.ready;
			if (fonts && fonts.then) fonts.then(finish, finish);
			else finish();
		};
		var pending = Array.prototype.slice.call(document.images).filter(
			function (img) { return img.src && !img.complete; }
		);
		var left = pending.length;
		var step = function () { if (--left <= 0) waitFonts(); };
		pending.forEach(function (img) {
			img.addEventListener("load", step);
			img.addEventListener("error", step);
		});
		if (left === 0) waitFonts();
	});
})()`;
