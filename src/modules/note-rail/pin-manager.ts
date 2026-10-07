// Shared vault-pin interactions for the rail and Home. All document listeners belong to the mount.
import { Notice } from "obsidian";
import type { NoteRailService, VaultPinGroups } from "../../core/services";
import type { ToastOptions } from "../../ui/toast";

export const pinLabels = {
	"pins.new-folder": "New folder",
	"pins.rename-folder": "Rename folder",
	"pins.delete-folder": "Delete folder (keep pins)",
	"pins.folder-name": "Folder name",
	"pins.remove": "Remove pin",
	"pins.removed": "Pin removed",
	"pins.undo": "Undo",
	"pins.loose": "Outside folders",
	"pins.move-to": "Move to {name}",
	"pins.move-up": "Move up",
	"pins.move-down": "Move down",
	"pins.save": "Save",
	"pins.cancel": "Cancel",
	"pins.error": "Could not save pins",
	"pins.empty": "No pins in this folder",
};

export interface PinsRowOptions {
	openNote(path: string, event?: MouseEvent | KeyboardEvent): void;
	t(key: string, vars?: Record<string, string | number>): string;
	/** A CSS color for the note's dot, or null. */
	dot?(path: string): string | null;
	toast?(message: string, options?: ToastOptions): void;
}

type Item = { path: string; folderId: string | null } | { id: string };

export function mountPinManager(el: HTMLElement, rail: NoteRailService, opts: PinsRowOptions, tokens: boolean): { update(): void; destroy(): void } {
	const doc = el.ownerDocument;
	const win = doc.defaultView!;
	const root = doc.createElement("div");
	root.className = `sk-pins ${tokens ? "is-tokens" : "is-list"}`;
	el.append(root);
	let dead = false;
	let groups: VaultPinGroups;
	let popup: HTMLElement | null = null;
	let popupOwner: HTMLElement | null = null;
	let openFolder: string | null = null;
	const expanded = new Set<string>();
	let menuOpen = false;
	let drag: { item: Item; row: HTMLElement; x: number; y: number; pointer: number; active: boolean } | null = null;
	let drop: { folderId: string | null; index: number } | null = null;
	let marked: HTMLElement | null = null;
	let suppressUntil = 0;
	let pendingUpdate = false;
	const cleanups: (() => void)[] = [];
	const items = new WeakMap<HTMLElement, Item>();
	const t = (key: keyof typeof pinLabels, vars?: Record<string, string | number>): string => {
		const translated = opts.t(key, vars);
		return (translated && translated !== key ? translated : pinLabels[key]).replace(/\{(\w+)\}/g, (match, name) => String(vars?.[name] ?? match));
	};
	const listen = (target: EventTarget, name: string, handler: EventListener, capture = false): void => {
		target.addEventListener(name, handler, capture);
		cleanups.push(() => target.removeEventListener(name, handler, capture));
	};
	const run = (action: () => Promise<unknown>): void => {
		void action().catch((error) => {
			console.error("[Snailkit] Could not save pins", error);
			if (opts.toast) opts.toast(t("pins.error"));
			else if (!dead) new Notice(t("pins.error"));
		});
	};
	const button = (parent: HTMLElement, label: string, action: (e: MouseEvent) => void): HTMLButtonElement => {
		const b = doc.createElement("button");
		b.type = "button";
		b.className = "sk-btn is-ghost is-s";
		b.textContent = label;
		b.addEventListener("click", (e) => { e.stopPropagation(); action(e); });
		parent.append(b);
		return b;
	};
	const closePopup = (focus = false): void => {
		popup?.remove();
		popup = null;
		openFolder = null;
		menuOpen = false;
		popupOwner?.setAttribute("aria-expanded", "false");
		if (focus && popupOwner?.isConnected) popupOwner.focus();
		popupOwner = null;
	};
	const makePopup = (owner: HTMLElement, menu: boolean): HTMLElement => {
		closePopup();
		popupOwner = owner;
		menuOpen = menu;
		const p = doc.createElement("div");
		p.className = "sk-pins-popup";
		// The top layer escapes transformed or clipped ancestors, while DOM ownership stays local.
		p.setAttribute("popover", "manual");
		const rect = owner.getBoundingClientRect();
		p.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - 272))}px`;
		p.style.top = `${Math.max(8, Math.min(rect.bottom + 4, win.innerHeight - 260))}px`;
		p.style.maxHeight = `${Math.max(80, win.innerHeight - parseFloat(p.style.top) - 8)}px`;
		root.append(p);
		p.showPopover?.();
		popup = p;
		return p;
	};
	const folderName = (owner: HTMLElement, id?: string): void => {
		const p = makePopup(owner, true);
		const form = doc.createElement("form");
		const input = doc.createElement("input");
		input.type = "text";
		input.placeholder = t("pins.folder-name");
		input.setAttribute("aria-label", t("pins.folder-name"));
		input.value = groups.folders.find((f) => f.id === id)?.name ?? "";
		form.append(input);
		const save = button(form, t("pins.save"), () => form.requestSubmit());
		save.disabled = !input.value.trim();
		input.addEventListener("input", () => { save.disabled = !input.value.trim(); });
		button(form, t("pins.cancel"), () => { closePopup(true); if (pendingUpdate) update(); });
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			const name = input.value.trim();
			if (!name) return;
			closePopup(true);
			run(() => id ? rail.renamePinFolder(id, name) : rail.createPinFolder(name));
		});
		p.append(form);
		input.focus();
		input.select();
	};
	const remove = (path: string): void => {
		const before = rail.listPins();
		const folder = before.folders.find((f) => f.pins.includes(path));
		const index = (folder?.pins ?? before.loose).indexOf(path);
		// The toast and its Undo depend on the service, not on this row: removing the last pin may
		// remove the row itself (the Home hides an empty Pins row). A stopped service ignores writes.
		run(async () => {
			await rail.removePin(path);
			opts.toast?.(t("pins.removed"), { action: { label: t("pins.undo"), run: () => {
				if (rail.isPinned(path)) return;
				run(async () => {
					await rail.setPinned(path, true);
					const exists = rail.listPins().folders.some((f) => f.id === folder?.id);
					await rail.movePin(path, index, exists ? folder!.id : null);
				});
			} } });
		});
	};
	const step = (item: Item, delta: number): void => {
		const now = rail.listPins();
		if ("id" in item) {
			const index = now.folders.findIndex((f) => f.id === item.id);
			if (index >= 0) run(() => rail.movePinFolder(item.id, index + delta));
		} else {
			const list = item.folderId ? now.folders.find((f) => f.id === item.folderId)?.pins : now.loose;
			const index = list?.indexOf(item.path) ?? -1;
			if (index >= 0) run(() => rail.movePin(item.path, index + delta, item.folderId));
		}
	};
	const context = (owner: HTMLElement, item?: Item): void => {
		const anchor = popupOwner ?? owner;
		const p = makePopup(anchor, true);
		p.setAttribute("role", "menu");
		const action = (label: string, fn: () => void): void => {
			button(p, label, () => { closePopup(true); fn(); }).setAttribute("role", "menuitem");
		};
		if (item) {
			action(t("pins.move-up"), () => step(item, -1));
			action(t("pins.move-down"), () => step(item, 1));
			if ("path" in item) {
				action(t("pins.remove"), () => remove(item.path));
				for (const folder of [{ id: null, name: t("pins.loose") }, ...groups.folders]) {
					if (folder.id === item.folderId) continue;
					action(t("pins.move-to", { name: folder.name }), () => run(() => rail.movePin(item.path, Infinity, folder.id)));
				}
			} else {
				action(t("pins.rename-folder"), () => folderName(anchor, item.id));
				action(t("pins.delete-folder"), () => run(() => rail.deletePinFolder(item.id)));
			}
		}
		action(t("pins.new-folder"), () => folderName(anchor));
		p.querySelector<HTMLButtonElement>("button")?.focus();
	};
	const wire = (row: HTMLElement, item: Item): void => {
		items.set(row, item);
		row.dataset.pinItem = "true";
		row.dataset.pinKey = "path" in item ? `pin:${item.path}` : `folder:${item.id}`;
		row.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); context(row, item); });
		row.addEventListener("keydown", (e) => {
			if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
				e.preventDefault(); e.stopPropagation(); step(item, e.key === "ArrowUp" ? -1 : 1);
			} else if (e.key === "Delete" && "path" in item) {
				e.preventDefault(); e.stopPropagation(); remove(item.path);
			} else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
				e.preventDefault(); e.stopPropagation(); context(row, item);
			} else if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
				const stops = Array.from((popup?.contains(row) ? popup : root)!.querySelectorAll<HTMLElement>("[data-pin-item]"));
				const next = stops.indexOf(row) + (e.key === "ArrowUp" ? -1 : 1);
				e.preventDefault(); e.stopPropagation(); stops[Math.max(0, Math.min(stops.length - 1, next))]?.focus();
			}
		});
	};
	const pin = (parent: HTMLElement, path: string, folderId: string | null): void => {
		const row = doc.createElement("div");
		row.className = "sk-pins-pin";
		const open = button(row, path.split("/").pop()!.replace(/\.md$/, ""), (e) => opts.openNote(path, e));
		open.title = path;
		wire(open, { path, folderId });
		open.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault(); e.stopPropagation(); opts.openNote(path, e);
			}
		});
		open.addEventListener("auxclick", (e) => {
			if (e.button === 1) { e.preventDefault(); e.stopPropagation(); opts.openNote(path, e); }
		});
		const color = opts.dot?.(path);
		if (color) {
			const dot = doc.createElement("span");
			dot.className = "sk-pins-dot";
			dot.style.backgroundColor = color;
			open.prepend(dot);
		}
		const x = button(row, "×", () => remove(path));
		x.classList.add("is-icon", "sk-pins-remove");
		x.setAttribute("aria-label", t("pins.remove"));
		x.dataset.pinFocus = `pin:${path}`;
		parent.append(row);
	};
	const showFolder = (owner: HTMLElement, id: string): void => {
		const folder = groups.folders.find((f) => f.id === id);
		if (!folder) return;
		const p = makePopup(owner, false);
		openFolder = id;
		owner.setAttribute("aria-expanded", "true");
		p.dataset.pinDestination = id;
		folder.pins.forEach((path) => pin(p, path, id));
		if (!folder.pins.length) p.textContent = t("pins.empty");
	};
	function update(): void {
		if (dead) return;
		if (drag) { pendingUpdate = true; return; }
		// Do not discard a folder name being typed because another device changed the pins.
		if (menuOpen) { groups = rail.listPins(); pendingUpdate = true; return; }
		const active = doc.activeElement as HTMLElement | null;
		const focusKey = root.contains(active) ? active?.dataset.pinKey ?? active?.dataset.pinFocus : undefined;
		const oldKeys = Array.from(root.querySelectorAll<HTMLElement>("[data-pin-key]")).map((r) => r.dataset.pinKey);
		const reopen = openFolder;
		closePopup();
		groups = rail.listPins();
		root.replaceChildren();
		const loose = doc.createElement("div");
		loose.className = "sk-pins-loose";
		loose.dataset.pinDestination = "";
		loose.dataset.emptyLabel = t("pins.loose");
		groups.loose.forEach((path) => pin(loose, path, null));
		root.append(loose);
		for (const folder of groups.folders) {
			const section = doc.createElement("div");
			section.className = "sk-pins-folder";
			const heading = button(section, `${tokens ? "▸" : expanded.has(folder.id) ? "▾" : "▸"} ${folder.name} (${folder.pins.length})`, () => {
				if (tokens) {
					if (openFolder === folder.id) closePopup();
					else { showFolder(heading, folder.id); popup?.querySelector<HTMLButtonElement>("button")?.focus(); }
				} else {
					if (expanded.has(folder.id)) expanded.delete(folder.id); else expanded.add(folder.id);
					update();
				}
			});
			heading.setAttribute("aria-expanded", String(tokens ? reopen === folder.id : expanded.has(folder.id)));
			wire(heading, { id: folder.id });
			heading.dataset.pinDestination = folder.id;
			root.append(section);
			if (!tokens && expanded.has(folder.id)) {
				const list = doc.createElement("div");
				list.className = "sk-pins-folder-list";
				list.dataset.pinDestination = folder.id;
				folder.pins.forEach((path) => pin(list, path, folder.id));
				if (!folder.pins.length) list.textContent = t("pins.empty");
				section.append(list);
			}
			if (tokens && reopen === folder.id) showFolder(heading, folder.id);
		}
		const add = button(root, "+", () => folderName(add));
		add.classList.add("is-icon", "sk-pins-add");
		add.setAttribute("aria-label", t("pins.new-folder"));
		if (focusKey) {
			const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-pin-key]"));
			const folder = groups.folders.find((f) => f.pins.some((path) => `pin:${path}` === focusKey));
			const target = rows.find((r) => r.dataset.pinKey === focusKey)
				?? rows.find((r) => folder && r.dataset.pinKey === `folder:${folder.id}`)
				?? rows[Math.max(0, Math.min(rows.length - 1, oldKeys.indexOf(focusKey)))];
			(target ?? add).focus();
		}
		pendingUpdate = false;
	}
	const finish = (commit: boolean): void => {
		const d = drag;
		if (!d) return;
		drag = null;
		root.classList.remove("is-dragging");
		d.row.classList.remove("is-drag-source");
		marked?.classList.remove("is-drop-target");
		marked = null;
		if (d.active) suppressUntil = Date.now() + 400;
		if (commit && d.active && drop) {
			const target = drop;
			if ("id" in d.item) { const id = d.item.id; run(() => rail.movePinFolder(id, target.index)); }
			else { const path = d.item.path; run(() => rail.movePin(path, target.index, target.folderId)); }
		}
		drop = null;
		if (pendingUpdate) update();
	};
	listen(root, "pointerdown", ((e: PointerEvent) => {
		if (e.button !== 0 || e.pointerType === "touch" || menuOpen) return;
		const row = (e.target as Element).closest<HTMLElement>("[data-pin-item]");
		const item = row && items.get(row);
		if (!row || !item) return;
		drag = { item, row, x: e.clientX, y: e.clientY, pointer: e.pointerId, active: false };
	}) as EventListener);
	listen(win, "pointermove", ((e: PointerEvent) => {
		const d = drag;
		if (!d || e.pointerId !== d.pointer) return;
		if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
		d.active = true;
		e.preventDefault();
		root.classList.add("is-dragging");
		d.row.classList.add("is-drag-source");
		marked?.classList.remove("is-drop-target");
		marked = null;
		drop = null;
		const hit = doc.elementFromPoint(e.clientX, e.clientY);
		if (!hit || !root.contains(hit)) return;
		const row = hit.closest<HTMLElement>("[data-pin-item]");
		const target = row && items.get(row);
		const rect = row?.getBoundingClientRect();
		const after = rect ? (tokens && !row?.closest(".sk-pins-popup") ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2) : false;
		const now = rail.listPins();
		if ("id" in d.item) {
			const id = d.item.id;
			if (!target || !("id" in target) || target.id === id) return;
			const others = now.folders.filter((f) => f.id !== id);
			drop = { folderId: null, index: others.findIndex((f) => f.id === target.id) + Number(after) };
		} else {
			const path = d.item.path;
			let folderId: string | null;
			let index: number;
			if (target && "path" in target) {
				if (target.path === path) return;
				folderId = target.folderId;
				const list = folderId ? now.folders.find((f) => f.id === folderId)?.pins ?? [] : now.loose;
				index = list.filter((p) => p !== path).indexOf(target.path) + Number(after);
			} else {
				const destination = hit.closest<HTMLElement>("[data-pin-destination]");
				if (!destination) return;
				folderId = destination.dataset.pinDestination || null;
				index = Infinity;
			}
			drop = { folderId, index };
		}
		marked = row ?? hit.closest<HTMLElement>("[data-pin-destination]");
		marked?.classList.add("is-drop-target");
	}) as EventListener, true);
	listen(win, "pointerup", ((e: PointerEvent) => { if (e.pointerId === drag?.pointer) finish(true); }) as EventListener, true);
	listen(win, "pointercancel", (() => finish(false)) as EventListener, true);
	listen(win, "blur", (() => { finish(false); closePopup(); }) as EventListener);
	listen(root, "click", ((e: MouseEvent) => {
		if (Date.now() < suppressUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
	}) as EventListener, true);
	listen(root, "contextmenu", ((e: MouseEvent) => {
		if (e.defaultPrevented || popup?.contains(e.target as Node)) return;
		e.preventDefault(); context(root);
	}) as EventListener);
	listen(doc, "pointerdown", ((e: PointerEvent) => {
		if (popup && !popup.contains(e.target as Node) && !popupOwner?.contains(e.target as Node)) {
			closePopup();
			if (pendingUpdate) update();
		}
	}) as EventListener, true);
	listen(win, "keydown", ((e: KeyboardEvent) => {
		if (e.key === "Escape" && (drag || popup)) {
			e.preventDefault(); e.stopImmediatePropagation(); finish(false); closePopup(true);
			if (pendingUpdate) update();
		} else if (popup?.contains(e.target as Node) && menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
			const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
			if (!buttons.length) return;
			e.preventDefault(); e.stopPropagation();
			const i = buttons.indexOf(doc.activeElement as HTMLButtonElement);
			buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length].focus();
		}
	}) as EventListener, true);
	listen(win, "resize", (() => closePopup()) as EventListener);
	cleanups.push(rail.onPinsChange(update));
	update();
	return { update, destroy() {
		dead = true;
		finish(false);
		closePopup();
		cleanups.forEach((off) => off());
		root.remove();
	} };
}
