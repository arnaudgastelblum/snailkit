// Hand-written OOXML and stored ZIP writer, ported from the source exporter.
import { placeImage, type SlideSize, type Placement } from "./logic";
export interface RenderedSlide { title: string; png: Uint8Array; width: number; height: number }
export interface ZipEntry { name: string; data: Uint8Array }
interface Relationship { id: string; type: string; target: string }
interface PptxOptions { slides: RenderedSlide[]; size: SlideSize; background: string | null; title: string; date: Date }

export function parseHexColor(color: string): number[] | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || "").trim());
	if (!m) return null;
	let hex = m[1];
	if (hex.length === 3) {
		hex = hex
			.split("")
			.map((c) => c + c)
			.join("");
	}
	const n = parseInt(hex, 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}

// Excalidraw renders the dark theme by filtering the light rendering with
// "invert(93%) hue-rotate(180deg)". Applying the same filter to the canvas
// color gives the exact background of a dark export (white becomes #121212).
export function darkThemeColor([r, g, b]: number[]) {
	const invert = (c: number) => 255 * 0.93 + c * (1 - 2 * 0.93);
	const [ir, ig, ib] = [r, g, b].map(invert);
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return [
		clamp(-0.574 * ir + 1.43 * ig + 0.144 * ib),
		clamp(0.426 * ir + 0.43 * ig + 0.144 * ib),
		clamp(0.426 * ir + 1.43 * ig - 0.856 * ib),
	];
}

// Hex color (RRGGBB, no hash) of the slide background for a canvas color and
// a theme. Unknown colors (transparent, names) fall back to white.
export function slideBackground(viewBackgroundColor: string, theme: string) {
	const rgb = parseHexColor(viewBackgroundColor) || [255, 255, 255];
	const out = theme === "dark" ? darkThemeColor(rgb) : rgb;
	return out
		.map((c) => c.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

// PNG: only the header is read, for the picture's pixel size

export function pngDimensions(bytes: Uint8Array) {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (bytes.length < 24 || signature.some((value, i) => bytes[i] !== value) ||
		bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) {
		throw new Error("Excalidraw did not return a PNG image");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	if (!width || !height) throw new Error("PNG dimensions must be positive");
	return { width, height };
}

// ZIP: a .pptx is a ZIP archive

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array) {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

export function dosDateTime(date: Date) {
	const year = Math.max(1980, date.getFullYear());
	return {
		time:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			(date.getSeconds() >> 1),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

// Every entry is stored uncompressed: the PNGs are already compressed and the
// XML parts are small, so deflating would gain little, and nothing outside
// this file is needed to write the archive. Entries: [{ name, data }] with
// data as Uint8Array.
export function buildZip(entries: ZipEntry[], date: Date) {
	const stamp = dosDateTime(date);
	const encoder = new TextEncoder();
	const parts = [];
	const central = [];
	let offset = 0;
	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const data = entry.data;
		const crc = crc32(data);

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, 0, true);
		lv.setUint16(8, 0, true);
		lv.setUint16(10, stamp.time, true);
		lv.setUint16(12, stamp.date, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, data.length, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, 0, true);
		local.set(name, 30);

		const dir = new Uint8Array(46 + name.length);
		const dv = new DataView(dir.buffer);
		dv.setUint32(0, 0x02014b50, true);
		dv.setUint16(4, 20, true);
		dv.setUint16(6, 20, true);
		dv.setUint16(8, 0, true);
		dv.setUint16(10, 0, true);
		dv.setUint16(12, stamp.time, true);
		dv.setUint16(14, stamp.date, true);
		dv.setUint32(16, crc, true);
		dv.setUint32(20, data.length, true);
		dv.setUint32(24, data.length, true);
		dv.setUint16(28, name.length, true);
		dv.setUint16(30, 0, true);
		dv.setUint16(32, 0, true);
		dv.setUint16(34, 0, true);
		dv.setUint16(36, 0, true);
		dv.setUint32(38, 0, true);
		dv.setUint32(42, offset, true);
		dir.set(name, 46);

		parts.push(local, data);
		central.push(dir);
		offset += local.length + data.length;
	}
	const centralSize = central.reduce((sum, d) => sum + d.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(4, 0, true);
	ev.setUint16(6, 0, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	ev.setUint16(20, 0, true);

	const all = parts.concat(central, [end]);
	const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0));
	let pos = 0;
	for (const p of all) {
		out.set(p, pos);
		pos += p.length;
	}
	return out;
}

// PPTX: the smallest Office Open XML package PowerPoint opens cleanly

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CT_PML = "application/vnd.openxmlformats-officedocument.presentationml.";
const PML_NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

// An empty shape tree is still a group with a transform.
const EMPTY_TREE =
	'<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
	'<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
	'<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

export function xmlEscape(s: string) {
	return String(s)
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function relationships(items: Relationship[]) {
	const rels = items
		.map(
			(r) =>
				`<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEscape(r.target)}"/>`
		)
		.join("");
	return `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels}</Relationships>`;
}

export function contentTypesXml(slideCount: number) {
	const slides = [];
	for (let i = 1; i <= slideCount; i++) {
		slides.push(
			`<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${CT_PML}slide+xml"/>`
		);
	}
	return (
		`${XML_HEAD}<Types xmlns="${NS_CT}">` +
		'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
		'<Default Extension="xml" ContentType="application/xml"/>' +
		'<Default Extension="png" ContentType="image/png"/>' +
		`<Override PartName="/ppt/presentation.xml" ContentType="${CT_PML}presentation.main+xml"/>` +
		`<Override PartName="/ppt/presProps.xml" ContentType="${CT_PML}presProps+xml"/>` +
		`<Override PartName="/ppt/tableStyles.xml" ContentType="${CT_PML}tableStyles+xml"/>` +
		`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT_PML}slideMaster+xml"/>` +
		`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT_PML}slideLayout+xml"/>` +
		'<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
		'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
		'<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
		slides.join("") +
		"</Types>"
	);
}

export function rootRelsXml() {
	return relationships([
		{ id: "rId1", type: `${REL}officeDocument`, target: "ppt/presentation.xml" },
		{
			id: "rId2",
			type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
			target: "docProps/core.xml",
		},
		{ id: "rId3", type: `${REL}extended-properties`, target: "docProps/app.xml" },
	]);
}

export function coreXml(title: string, date: Date) {
	const stamp = date.toISOString().replace(/\.\d{3}Z$/, "Z");
	return (
		`${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"` +
		' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
		' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
		`<dc:title>${xmlEscape(title)}</dc:title>` +
		`<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
		`<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
		"</cp:coreProperties>"
	);
}

export function appXml(slideCount: number) {
	return (
		`${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"` +
		' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
		"<Application>Snailkit</Application>" +
		`<Slides>${slideCount}</Slides>` +
		"</Properties>"
	);
}

export function presentationXml(slideCount: number, size: SlideSize) {
	const ids = [];
	for (let i = 1; i <= slideCount; i++) {
		ids.push(`<p:sldId id="${255 + i}" r:id="rId${1 + i}"/>`);
	}
	return (
		`${XML_HEAD}<p:presentation ${PML_NS}>` +
		'<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
		`<p:sldIdLst>${ids.join("")}</p:sldIdLst>` +
		`<p:sldSz cx="${size.cx}" cy="${size.cy}"/>` +
		'<p:notesSz cx="6858000" cy="9144000"/>' +
		"</p:presentation>"
	);
}

export function presentationRelsXml(slideCount: number) {
	const rels = [
		{ id: "rId1", type: `${REL}slideMaster`, target: "slideMasters/slideMaster1.xml" },
	];
	for (let i = 1; i <= slideCount; i++) {
		rels.push({ id: `rId${1 + i}`, type: `${REL}slide`, target: `slides/slide${i}.xml` });
	}
	rels.push(
		{ id: `rId${slideCount + 2}`, type: `${REL}theme`, target: "theme/theme1.xml" },
		{ id: `rId${slideCount + 3}`, type: `${REL}presProps`, target: "presProps.xml" },
		{ id: `rId${slideCount + 4}`, type: `${REL}tableStyles`, target: "tableStyles.xml" }
	);
	return relationships(rels);
}

export function presPropsXml() {
	return `${XML_HEAD}<p:presentationPr ${PML_NS}/>`;
}

export function tableStylesXml() {
	return `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
}

export function slideMasterXml() {
	return (
		`${XML_HEAD}<p:sldMaster ${PML_NS}>` +
		'<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
		`<p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
		'<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"' +
		' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
		'<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
		"<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>" +
		"</p:sldMaster>"
	);
}

export function slideMasterRelsXml() {
	return relationships([
		{ id: "rId1", type: `${REL}slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
		{ id: "rId2", type: `${REL}theme`, target: "../theme/theme1.xml" },
	]);
}

export function slideLayoutXml() {
	return (
		`${XML_HEAD}<p:sldLayout ${PML_NS} type="blank" preserve="1">` +
		`<p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
		"<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
		"</p:sldLayout>"
	);
}

export function slideLayoutRelsXml() {
	return relationships([
		{ id: "rId1", type: `${REL}slideMaster`, target: "../slideMasters/slideMaster1.xml" },
	]);
}

// The default Office theme, reduced to what the schema requires: a color
// scheme, a font scheme and three fill, line, effect and background styles.
export function themeXml() {
	const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
	const line = (w: number) => `<a:ln w="${w}">${fill}</a:ln>`;
	const effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
	return (
		`${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="Office Theme"><a:themeElements>` +
		'<a:clrScheme name="Office">' +
		'<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
		'<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
		'<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
		'<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
		'<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
		'<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
		'<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
		"</a:clrScheme>" +
		'<a:fontScheme name="Office">' +
		'<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
		'<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
		"</a:fontScheme>" +
		'<a:fmtScheme name="Office">' +
		`<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>` +
		`<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
		`<a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>` +
		`<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>` +
		"</a:fmtScheme>" +
		"</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
	);
}

// One slide: an optional solid background and the picture, contain-fitted.
export function slideXml(slide: RenderedSlide, place: Placement, background: string | null) {
	const title = xmlEscape(slide.title);
	const bg = background
		? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
		: "";
	return (
		`${XML_HEAD}<p:sld ${PML_NS}>` +
		`<p:cSld name="${title}">${bg}<p:spTree>${EMPTY_TREE}` +
		"<p:pic><p:nvPicPr>" +
		`<p:cNvPr id="2" name="${title}" descr="${title}"/>` +
		'<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/>' +
		"</p:nvPicPr>" +
		'<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
		`<p:spPr><a:xfrm><a:off x="${place.x}" y="${place.y}"/><a:ext cx="${place.cx}" cy="${place.cy}"/></a:xfrm>` +
		'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
		"</p:pic></p:spTree></p:cSld>" +
		"<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
		"</p:sld>"
	);
}

export function slideRelsXml(index: number) {
	return relationships([
		{ id: "rId1", type: `${REL}slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
		{ id: "rId2", type: `${REL}image`, target: `../media/image${index}.png` },
	]);
}

// The whole file. slides: [{ title, png (Uint8Array), width, height }],
// size: one of SLIDE_SIZES, background: RRGGBB or null, title: document title.
export function buildPptx({ slides, size, background, title, date }: PptxOptions) {
	const n = slides.length;
	const entries: Array<{ name: string; data: string | Uint8Array }> = [
		{ name: "[Content_Types].xml", data: contentTypesXml(n) },
		{ name: "_rels/.rels", data: rootRelsXml() },
		{ name: "docProps/core.xml", data: coreXml(title, date) },
		{ name: "docProps/app.xml", data: appXml(n) },
		{ name: "ppt/presentation.xml", data: presentationXml(n, size) },
		{ name: "ppt/_rels/presentation.xml.rels", data: presentationRelsXml(n) },
		{ name: "ppt/presProps.xml", data: presPropsXml() },
		{ name: "ppt/tableStyles.xml", data: tableStylesXml() },
		{ name: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml() },
		{ name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: slideMasterRelsXml() },
		{ name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml() },
		{ name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: slideLayoutRelsXml() },
		{ name: "ppt/theme/theme1.xml", data: themeXml() },
	];
	slides.forEach((slide, i) => {
		const index = i + 1;
		const place = placeImage(slide.width, slide.height, size);
		entries.push(
			{ name: `ppt/slides/slide${index}.xml`, data: slideXml(slide, place, background) },
			{ name: `ppt/slides/_rels/slide${index}.xml.rels`, data: slideRelsXml(index) },
			{ name: `ppt/media/image${index}.png`, data: slide.png }
		);
	});
	const encoder = new TextEncoder();
	return buildZip(
		entries.map((e) => ({
			name: e.name,
			data: typeof e.data === "string" ? encoder.encode(e.data) : e.data,
		})),
		date
	);
}
