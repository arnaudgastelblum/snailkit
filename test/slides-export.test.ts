import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Notice, Platform, TFile, TFolder, type App } from "obsidian";
import type { ModuleContext } from "../src/core/context";
import { SlidesExporter } from "../src/modules/slides-export/exporter";
import { slidesExport } from "../src/modules/slides-export";
import type { Automate, DrawingView, SlidesSettings } from "../src/modules/slides-export/types";
import { buildSlides, exportAreaFor, folderPath, frameTitle, orderFrames, placeImage, presentationTitle, readSlideshowData, renderScale, SLIDE_SIZES, validFolder, validRectangle, vaultPptxPath, withPptxExtension, type SceneElement } from "../src/modules/slides-export/logic";
import { buildPptx, buildZip, contentTypesXml, crc32, pngDimensions, presentationRelsXml, presentationXml, slideBackground, slideRelsXml, xmlEscape } from "../src/modules/slides-export/pptx";
import { unavailableReason } from "../src/modules/slides-export/availability";

const frame = (id: string, name?: string, order?: number, excluded = false): SceneElement => ({
	id, name, type: "frame", x: 10, y: 20, width: 800, height: 600,
	customData: order === undefined ? undefined : { slideshow: { kind: "frame", order, excluded } },
});
const date = new Date(2026, 0, 2, 3, 4, 6);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("Slideshow order precedes names, ties stay in scene order, exclusions always disappear", () => {
	const elements = [frame("last", "Wrap up", 2), frame("plain", "Agenda"), frame("first", "Project kickoff", 0), frame("excluded", "Draft", 1, true), frame("tie", "Details", 0), frame("unnamed")];
	assert.deepEqual(buildSlides(elements).map((slide) => slide.id), ["first", "tie", "last", "plain", "unnamed"]);
	assert.equal(buildSlides(elements).at(-1)?.title, "Frame 06");
	assert.equal(elements[0].id, "last");
	assert.deepEqual(orderFrames([frame("b", "B"), frame("a", "A"), frame("tie", "A")]).map((entry) => entry.frame.id), ["a", "tie", "b"]);
});

test("only live ordinary frames count toward fallback names", () => {
	const elements = [{ ...frame("deleted"), isDeleted: true }, { ...frame("shape"), type: "rectangle" }, frame("one"), frame("skip", "", 0, true), frame("three")];
	assert.deepEqual(buildSlides(elements).map((slide) => slide.title), ["Frame 01", "Frame 03"]);
	assert.equal(frameTitle({}, 99), "Frame 100");
	assert.deepEqual(buildSlides([frame("excluded", "Draft", 0, true)]), []);
});

test("metadata handles missing, malformed and legacy data", () => {
	for (const value of [undefined, null, "bad", [], { kind: "path" }]) assert.equal(readSlideshowData({ slideshow: value }), null);
	assert.deepEqual(readSlideshowData({ slideshow: { order: Infinity, excluded: true } }), { order: 0, excluded: true });
	assert.deepEqual(readSlideshowData({ slideshow: { kind: "frame", order: -2, excluded: "true" } }), { order: -2, excluded: false });
});

test("clipping keeps the frame rectangle and rejects unusable geometry", () => {
	assert.deepEqual(exportAreaFor(frame("one")), { x: 10, y: 20, width: 800, height: 600 });
	assert.ok(validRectangle(frame("one")));
	for (const width of [0, -1, NaN, Infinity]) assert.equal(validRectangle({ ...frame("one"), width }), false);
});

test("contain fit makes centered bands with integer EMU for all slide ratios", () => {
	assert.deepEqual(placeImage(1920, 1080, SLIDE_SIZES["16:9"]), { x: 0, y: 0, cx: 12192000, cy: 6858000 });
	assert.deepEqual(placeImage(1000, 1000, SLIDE_SIZES["16:9"]), { x: 2667000, y: 0, cx: 6858000, cy: 6858000 });
	assert.deepEqual(placeImage(4000, 1000, SLIDE_SIZES["16:9"]), { x: 0, y: 1905000, cx: 12192000, cy: 3048000 });
	for (const size of Object.values(SLIDE_SIZES)) {
		for (const [width, height] of [[400, 300], [1600, 1000], [200, 900], [3100, 400]]) {
			const placement = placeImage(width, height, size);
			assert.ok(Object.values(placement).every(Number.isInteger));
			assert.ok(placement.cx <= size.cx && placement.cy <= size.cy);
			assert.ok(Math.abs(placement.x * 2 + placement.cx - size.cx) <= 1);
			assert.ok(Math.abs(placement.y * 2 + placement.cy - size.cy) <= 1);
			for (const imageWidth of [1280, 1920, 2560, 3840]) {
				const scale = renderScale({ width, height }, size, imageWidth);
				assert.ok(width * scale <= imageWidth + 1e-8);
				assert.ok(height * scale <= imageWidth * size.cy / size.cx + 1e-8);
			}
		}
	}
	assert.equal(SLIDE_SIZES["4:3"].cx, 10 * 914400);
});

test("background bands follow Excalidraw's theme filter", () => {
	assert.equal(slideBackground("#fff", "dark"), "121212");
	assert.equal(slideBackground("#abc", "light"), "AABBCC");
	assert.equal(slideBackground("transparent", "light"), "FFFFFF");
});

// A synthetic header is enough for sizing tests; no drawing fixture is copied.
function pngHeader(width = 800, height = 600): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	bytes.set([73, 72, 68, 82], 12);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

test("PNG dimensions respect byte offsets and reject bad headers", () => {
	const bytes = new Uint8Array(30);
	bytes.set(pngHeader(), 3);
	assert.deepEqual(pngDimensions(bytes.subarray(3, 27)), { width: 800, height: 600 });
	assert.throws(() => pngDimensions(new Uint8Array(24)));
	assert.throws(() => pngDimensions(pngHeader(0)));
	assert.throws(() => pngDimensions(pngHeader().subarray(0, 16)));
});

// Validate the archive independently by traversing local and central records.
function unzipStored(bytes: Uint8Array): Map<string, Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = bytes.length - 22;
	assert.equal(view.getUint32(end, true), 0x06054b50);
	const count = view.getUint16(end + 10, true);
	const centralOffset = view.getUint32(end + 16, true);
	assert.equal(centralOffset + view.getUint32(end + 12, true), end);
	const entries = new Map<string, Uint8Array>();
	let offset = 0;
	let central = centralOffset;
	for (let i = 0; i < count; i++) {
		assert.equal(view.getUint32(offset, true), 0x04034b50);
		assert.equal(view.getUint16(offset + 8, true), 0);
		const length = view.getUint32(offset + 18, true);
		assert.equal(view.getUint32(offset + 22, true), length);
		const nameLength = view.getUint16(offset + 26, true);
		const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
		const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
		const data = bytes.subarray(start, start + length);
		assert.equal(view.getUint32(offset + 14, true), crc32(data));
		assert.equal(view.getUint32(central, true), 0x02014b50);
		assert.equal(view.getUint32(central + 42, true), offset);
		assert.equal(view.getUint32(central + 16, true), crc32(data));
		assert.equal(view.getUint32(central + 20, true), length);
		assert.equal(decoder.decode(bytes.subarray(central + 46, central + 46 + nameLength)), name);
		assert.ok(!entries.has(name));
		entries.set(name, data);
		offset = start + length;
		central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
	}
	assert.equal(offset, centralOffset);
	assert.equal(central, end);
	return entries;
}

test("CRC32 standard vector and stored ZIP records", () => {
	assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
	assert.equal(crc32(new Uint8Array()), 0);
	const entries = [{ name: "empty.xml", data: new Uint8Array() }, { name: "data.xml", data: encoder.encode("Project kickoff") }];
	const archive = unzipStored(buildZip(entries, date));
	assert.deepEqual([...archive.keys()], entries.map((entry) => entry.name));
	assert.equal(decoder.decode(archive.get("data.xml")), "Project kickoff");
	assert.equal(unzipStored(buildZip([], date)).size, 0);
});

test("OOXML content types, presentation IDs and relationships", () => {
	const types = contentTypesXml(2);
	assert.match(types, /Extension="png" ContentType="image\/png"/);
	assert.match(types, /PartName="\/ppt\/slides\/slide2.xml"/);
	assert.doesNotMatch(types, /slide3.xml/);
	assert.match(presentationXml(2, SLIDE_SIZES["4:3"]), /<p:sldId id="256" r:id="rId2"\/>/);
	assert.match(presentationXml(2, SLIDE_SIZES["4:3"]), /cx="9144000" cy="6858000"/);
	assert.match(presentationRelsXml(2), /Id="rId3"[^>]+Target="slides\/slide2.xml"/);
	assert.match(slideRelsXml(2), /Target="..\/media\/image2.png"/);
	assert.equal(xmlEscape('<Agenda & "goals">\u0001'), "&lt;Agenda &amp; &quot;goals&quot;&gt;");
});

test("PPTX contains all slide media, valid relationship targets and escaped titles", () => {
	const png = pngHeader();
	const entries = unzipStored(buildPptx({ slides: [{ title: "Project & goals", png, width: 800, height: 600 }, { title: "Next steps", png, width: 800, height: 600 }], size: SLIDE_SIZES["16:9"], title: "Project kickoff", background: "121212", date }));
	assert.equal([...entries.keys()][0], "[Content_Types].xml");
	assert.equal(entries.size, 19);
	assert.deepEqual(entries.get("ppt/media/image2.png"), png);
	const xml = decoder.decode(entries.get("ppt/slides/slide1.xml"));
	assert.match(xml, /name="Project &amp; goals"/);
	assert.match(xml, /<a:srgbClr val="121212"\/>/);
	assert.match(xml, /<a:off x="1524000" y="0"\/>/);
	assert.match(xml, /<a:blip r:embed="rId2"\/>/);
	for (const [name, data] of entries) {
		if (!name.endsWith(".rels")) continue;
		const base = name === "_rels/.rels" ? [] : name.split("/").slice(0, -2);
		for (const match of decoder.decode(data).matchAll(/Target="([^"]+)"/g)) {
			const parts = [...base];
			for (const part of match[1].split("/")) part === ".." ? parts.pop() : parts.push(part);
			assert.ok(entries.has(parts.join("/")), `${name} target exists: ${match[1]}`);
		}
	}
	const white = unzipStored(buildPptx({ slides: [{ title: "Agenda", png, width: 800, height: 600 }], size: SLIDE_SIZES["4:3"], title: "Agenda", background: null, date }));
	assert.doesNotMatch(decoder.decode(white.get("ppt/slides/slide1.xml")), /<p:bg>/);
});

test("file names remove only the final Excalidraw suffix and vault folders stay relative", () => {
	assert.equal(presentationTitle({ basename: "Project kickoff.excalidraw" }), "Project kickoff");
	assert.equal(presentationTitle({ basename: "Agenda.EXCALIDRAW" }), "Agenda");
	assert.equal(presentationTitle({ basename: "Project.excalidraw.notes" }), "Project.excalidraw.notes");
	assert.equal(withPptxExtension("Agenda.PPTX"), "Agenda.PPTX");
	assert.equal(withPptxExtension("Agenda"), "Agenda.pptx");
	assert.equal(vaultPptxPath("/", "Agenda"), "Agenda.pptx");
	assert.equal(vaultPptxPath("Exports/Decks", "Agenda.excalidraw"), "Exports/Decks/Agenda.pptx");
	assert.equal(folderPath(" /Exports\\Decks//./ "), "Exports/Decks");
	assert.equal(validFolder("../Outside"), false);
	assert.equal(validFolder("C:/Exports"), false);
	assert.equal(validFolder("Exports/Decks"), true);
});

test("availability distinguishes absent, disabled and loaded Excalidraw", () => {
	const id = "obsidian-excalidraw-plugin";
	const t = (key: string) => key;
	assert.equal(unavailableReason({} as App, t), "reason.missing");
	assert.equal(unavailableReason({ plugins: { manifests: { [id]: {} } } } as unknown as App, t), "reason.disabled");
	assert.equal(unavailableReason({ plugins: { plugins: { [id]: {} } } } as unknown as App, t), null);
});

function runtime(t: TestContext) {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const mobile = Platform.isMobile;
	const oldHide = Notice.prototype.hide;
	const oldMessage = Notice.prototype.setMessage;
	let hides = 0;
	Notice.prototype.hide = () => { hides++; };
	Notice.prototype.setMessage = function () { return this; };
	const files = new Map<string, TFile | TFolder>();
	let creates = 0;
	let modifies = 0;
	let renders = 0;
	let loads = 0;
	let render: Automate["createViewPNG"] = async () => new Blob([new Uint8Array(pngHeader()).buffer]);
	const options: Parameters<Automate["createViewPNG"]>[0][] = [];
	const plugins: Record<string, unknown> = { "obsidian-excalidraw-plugin": {} };
	const app = {
		plugins: { plugins, manifests: { "obsidian-excalidraw-plugin": {} } },
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			createFolder: async (path: string) => { files.set(path, new TFolder()); },
			createBinary: async (path: string, data: ArrayBuffer) => {
				assert.ok(unzipStored(new Uint8Array(data)).has("ppt/slides/slide1.xml"));
				creates++;
				files.set(path, new TFile());
			},
			modifyBinary: async () => { modifies++; },
		},
	} as unknown as App;
	const ctx = {
		app, settings: { ...slidesExport.defaults },
		t: (key: string) => key,
		tn: (key: string) => key,
		saveSettings: async () => undefined,
	} as unknown as ModuleContext<SlidesSettings>;
	const view = { file: { basename: "Project kickoff.excalidraw", parent: { path: "/" } } } as DrawingView;
	const ea: Automate = {
		setView: (target) => { assert.equal(target, view); },
		getViewElements: () => [frame("one", "Agenda")],
		getExcalidrawAPI: () => ({ getAppState: () => ({ theme: "light", viewBackgroundColor: "#ffffff" }) }),
		createViewPNG: async (value) => { renders++; options.push(value); return render(value); },
	};
	const win = { ExcalidrawAutomate: ea, require: (_id: string): unknown => { loads++; throw new Error("Unexpected desktop load"); } };
	Object.defineProperty(globalThis, "window", { configurable: true, value: win });
	t.after(() => {
		if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
		Platform.isMobile = mobile;
		Notice.prototype.hide = oldHide;
		Notice.prototype.setMessage = oldMessage;
	});
	return { ctx, view, win, plugins, files, options, setRender: (next: typeof render) => { render = next; }, counts: () => ({ creates, modifies, renders, loads, hides }) };
}

test("mobile ask mode stays in the vault, creates folders and replaces the previous deck", async (t) => {
	const env = runtime(t);
	Platform.isMobile = true;
	const exporter = new SlidesExporter(env.ctx);
	env.ctx.settings.outputFolder = "Exports/Decks";
	await exporter.exportView(env.view);
	await exporter.exportView(env.view);
	assert.equal(env.counts().creates, 1);
	assert.equal(env.counts().modifies, 1);
	assert.equal(env.counts().loads, 0);
	assert.equal(env.counts().hides, 2);
	assert.ok(env.files.has("Exports/Decks/Project kickoff.pptx"));
	assert.deepEqual(env.options[0].frameRendering, { enabled: true, clip: true, name: false, outline: false });
	assert.equal(env.options[0].embedScene, false);
	// A subsequent export reads the current settings.
	env.ctx.settings.withBackground = false;
	env.ctx.settings.theme = "dark";
	await exporter.exportView(env.view);
	assert.equal(env.options[2].withBackground, false);
	assert.equal(env.options[2].theme, "dark");
});

test("turning off during rendering prevents saving and holds the lock across reactivation", async (t) => {
	const env = runtime(t);
	Platform.isMobile = true;
	let finish!: (blob: Blob) => void;
	env.setRender(() => new Promise((resolve) => { finish = resolve; }));
	const exporter = new SlidesExporter(env.ctx);
	const pending = exporter.exportView(env.view);
	exporter.cancel();
	assert.equal(env.counts().hides, 1);
	await new SlidesExporter(env.ctx).exportView(env.view);
	assert.equal(env.counts().renders, 1);
	finish(new Blob([new Uint8Array(pngHeader()).buffer]));
	await pending;
	assert.equal(env.counts().creates, 0);
	env.setRender(async () => new Blob([new Uint8Array(pngHeader()).buffer]));
	await new SlidesExporter(env.ctx).exportView(env.view);
	assert.equal(env.counts().creates, 1);
});

test("desktop dialog cancellation happens before rendering or writing", async (t) => {
	const env = runtime(t);
	Platform.isMobile = false;
	let dialogs = 0;
	const parent = {};
	env.win.require = (id) => {
		if (id === "electron") return { remote: {
			getCurrentWindow: () => parent,
			dialog: { showSaveDialog: async (owner: unknown, options: { defaultPath: string }) => {
				assert.equal(owner, parent);
				assert.equal(options.defaultPath, "Project kickoff.pptx");
				dialogs++;
				return { canceled: true };
			} },
		} };
		return {};
	};
	await new SlidesExporter(env.ctx).exportView(env.view);
	assert.equal(dialogs, 1);
	assert.equal(env.counts().renders, 0);
	assert.equal(env.counts().creates, 0);
	assert.equal(env.counts().hides, 1);
});

test("disabling Excalidraw during a render stops before writing", async (t) => {
	const env = runtime(t);
	Platform.isMobile = true;
	const originalError = console.error;
	const errors: unknown[] = [];
	console.error = (...args) => { errors.push(args); };
	t.after(() => { console.error = originalError; });
	env.setRender(async () => {
		delete env.plugins["obsidian-excalidraw-plugin"];
		return new Blob([new Uint8Array(pngHeader()).buffer]);
	});
	await new SlidesExporter(env.ctx).exportView(env.view);
	assert.equal(env.counts().creates, 0);
	assert.equal(env.counts().hides, 1);
	assert.equal(errors.length, 1);
});
