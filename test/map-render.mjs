// Optional real-layout regression check against the isolated Obsidian harness.
// Run: node test/map-render.mjs (CDP_PORT defaults to 9338). No plugin build or deployment.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ absWorkingDir: root, entryPoints: ["src/ui/map/index.ts"], bundle: true, write: false, format: "iife", globalName: "MapUnderTest" });
const css = (await Promise.all(["src/styles/00-tokens.css", "src/styles/45-surface.css", "src/styles/60-map.css"].map(path => readFile(new URL("../" + path, import.meta.url), "utf8")))).join("\n");
const pages = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9338}/json`)).json();
const page = pages.find(page => page.type === "page" && page.url.startsWith("app://obsidian.md/index.html"));
assert.ok(page, "Isolated Obsidian page is available");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
try {
	const response = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Map rendering timed out")), 10000);
		socket.onmessage = event => {
			const message = JSON.parse(event.data);
			if (message.id === 1) { clearTimeout(timeout); resolve(message); }
		};
	});
	// A disposable iframe owns all DOM, CSS and listeners, independent of the current Home.
	const expression = `(async () => {
		const frame = document.createElement('iframe');
		frame.style.cssText = 'position:fixed;left:-20000px;width:1200px;height:700px';
		document.body.append(frame);
		let map;
		try {
			const doc = frame.contentDocument, win = frame.contentWindow;
			const style = doc.createElement('style');
			style.textContent = ${JSON.stringify(css)} + '\\nbody { font-family: Arial, sans-serif; margin: 0; }';
			doc.head.append(style);
			const component = win.eval(${JSON.stringify(bundle.outputFiles[0].text + "\nMapUnderTest;")});
			const box = doc.createElement('div'); box.style.width = '1200px'; doc.body.append(box);
			const label = 'Planning a growing project with a deliberately long name';
			const title = '2026-01-01 ' + label;
			const nodes = [{ id: 'home', label: 'Home', kind: 'root', hue: null, hasChildren: true },
				{ id: 'long', label, title, kind: 'note', hue: null, hasChildren: false }];
			const options = { home: 'home', mode: 'columns', source: {
				node: id => nodes.find(node => node.id === id), children: id => id === 'home' ? [nodes[1]] : [], parent: id => id === 'long' ? 'home' : null
			}, strings: { tree: 'Map', breadcrumbs: 'Path', more: n => n + ' more', moreLabel: n => n + ' more', recenter: 'Recenter', recenterTip: 'Recenter', back: 'Back', open: 'Open' }, icon() {} };
			const events = { open() {}, openPage() {}, pin() {}, menu() {} };
			map = component.mountMap(box, options, events);
			await new Promise(resolve => win.setTimeout(resolve, 500));
			let row = box.querySelector('[data-map-key="n:long"]'), text = row.querySelector('.sk-map-label');
			const desktop = { column: row.parentElement.clientWidth, row: row.getBoundingClientRect().width, label: text.clientWidth, truncated: text.scrollWidth > text.clientWidth };
			text.dispatchEvent(new win.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: 200, clientY: 170 }));
			await new Promise(resolve => win.setTimeout(resolve, 650));
			const tip = doc.querySelector('.sk-map-tooltip');
			const tooltip = { visible: !tip.hidden, text: tip.textContent, expected: title };
			map.destroy(); options.mode = 'tree'; box.style.width = '375px';
			map = component.mountMap(box, options, events);
			await new Promise(resolve => win.setTimeout(resolve, 500));
			row = box.querySelector('[data-map-key="n:long"]'); text = row.querySelector('.sk-map-label');
			const phone = { row: row.getBoundingClientRect().height, line: text.getBoundingClientRect().height, font: parseFloat(win.getComputedStyle(text).fontSize) };
			return { desktop, tooltip, phone };
		} finally { map?.destroy(); frame.remove(); }
	})()`;
	socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
	const message = await response;
	assert.equal(message.result?.exceptionDetails, undefined, JSON.stringify(message.result?.exceptionDetails));
	const result = message.result.result.value;
	assert.equal(result.desktop.column, 240);
	assert.equal(result.desktop.row, 240);
	assert.ok(result.desktop.label >= 200, "Long labels use the available column, beyond 150 px");
	assert.ok(result.desktop.truncated, "Long text retains ellipsis");
	assert.equal(result.tooltip.visible, true);
	assert.equal(result.tooltip.text, result.tooltip.expected);
	assert.equal(result.phone.row, 44);
	assert.ok(result.phone.line >= result.phone.font * 1.4, "Descenders have room within the clipped label");
	assert.ok(result.phone.line < result.phone.row);
	console.log("Map desktop width, full hover title and phone line box: passed", result);
} finally { socket.close(); }
