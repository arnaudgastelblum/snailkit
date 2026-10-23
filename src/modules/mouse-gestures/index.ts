import { Setting } from "obsidian";
import { buildDemo } from "./demo";
import { defineModule } from "../../core/module";
import { Gestures } from "./runtime";
import { ACTIONS, GESTURES, arrows, assign, cleanCustom, freeGesture, type ActionId, type Gesture, type GestureOwner } from "./logic";
import { CommandPicker, commandName } from "./commands";
import { closeLauncher, openLauncher } from "./launcher";
import { withLauncher } from "./launcher-logic";
import type { MouseGesturesSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

/** Actions on Snailkit's own tools, listed in their own section of the settings. */
const SNAILKIT_ACTIONS: ActionId[] = ["launcher", "home", "tasks", "brainstorm", "newNote"];

const DEFAULTS: MouseGesturesSettings = {
	close: "DR",
	reopen: "LU",
	back: "L",
	forward: "R",
	newTab: "DU",
	nextTab: "UR",
	prevTab: "UL",
	launcher: "D",
	home: "U",
	tasks: "RD",
	brainstorm: "LD",
	newNote: "DL",
	trail: true,
	custom: [],
};

/** A row of the settings: an action, or the custom gesture at that index. */
const keyOf = (owner: GestureOwner): string => ("action" in owner ? `action:${owner.action}` : `custom:${owner.custom}`);

/**
 * The last gesture that changed hands, said once on the row that took it: the page is drawn again
 * right after, so it waits here for that drawing.
 */
let moved: { row: string; gesture: Gesture; from: string } | null = null;

export const mouseGestures = defineModule<MouseGesturesSettings>({
	id: "mouse-gestures",
	icon: "mouse-pointer-2",
	category: "notes",
	strings: { en, fr, nl, es },
	demo: (el, t) => buildDemo(el, t),
	defaults: DEFAULTS,
	// Settings saved before the launcher: ↓ becomes the launcher, New tab moves to ↓ ↑.
	migrate: (stored) => withLauncher(stored, DEFAULTS as unknown as Record<string, string>),
	activate(ctx) {
		new Gestures(ctx);
		ctx.addCommand({ id: "launcher", name: ctx.t("command.launcher"), icon: "compass", callback: () => openLauncher(ctx) });
		ctx.register(() => closeLauncher());
	},
	settings(page) {
		let gone = false;
		page.onDispose(() => (gone = true));
		// Once the page is to be drawn again, the rows of your gestures stop answering: their index
		// may already point to another entry (one was removed while the save runs).
		let stale = false;
		const redraw = () => {
			stale = true;
			void page.save().then(() => {
				if (!gone) page.refresh();
			});
		};
		const commandLabel = (id: string) => commandName(page.app, id) ?? page.t("settings.custom-missing");
		/** Who holds a gesture now, other than `self`, by name; null when nobody does. */
		const holder = (gesture: Gesture, self: GestureOwner | null): { owner: GestureOwner; name: string } | null => {
			if (!gesture) return null;
			const action = ACTIONS.find((a) => page.settings[a] === gesture && !(self && "action" in self && self.action === a));
			if (action) return { owner: { action }, name: page.t(`action.${action}`) };
			const custom = cleanCustom(page.settings.custom);
			const i = custom.findIndex((c, k) => c.gesture === gesture && !(self && "custom" in self && self.custom === k));
			return i >= 0 ? { owner: { custom: i }, name: commandLabel(custom[i].command) } : null;
		};
		/** The gestures of a row's menu, each one already taken saying by whom ("↓ → · Close tab"). */
		const choicesFor = (self: GestureOwner): Record<string, string> => {
			const choices: Record<string, string> = {};
			for (const gesture of GESTURES) {
				const other = holder(gesture, self);
				choices[gesture] = other ? `${arrows(gesture)} · ${other.name}` : arrows(gesture);
			}
			choices[""] = page.t("common.off");
			return choices;
		};
		/** One gesture, one owner: the action or the custom gesture that had it loses it, and the row says so. */
		const give = (owner: GestureOwner, gesture: Gesture): void => {
			const from = holder(gesture, owner);
			const next = assign(page.settings, cleanCustom(page.settings.custom), owner, gesture);
			for (const a of ACTIONS) page.settings[a] = next.map[a];
			page.settings.custom = next.custom;
			moved = from ? { row: keyOf(owner), gesture, from: from.name } : null;
		};
		/** The message of a row that just took its gesture from another one. */
		const say = (setting: Setting, owner: GestureOwner) => {
			if (moved?.row !== keyOf(owner)) return;
			setting.descEl.createDiv({ cls: "sk-mouse-gestures-moved", text: page.t("settings.moved", { gesture: arrows(moved.gesture), owner: moved.from }) });
		};
		const shown = moved;

		const tabs = page.section(page.t("settings.gestures"), page.t("settings.gestures-desc"));
		const snailkit = page.section(page.t("settings.snailkit"), page.t("settings.snailkit-desc"));
		for (const action of ACTIONS) {
			const owner: GestureOwner = { action };
			const setting = (SNAILKIT_ACTIONS.includes(action) ? snailkit : tabs).dropdown(action, page.t(`action.${action}`), choicesFor(owner), {
				// The other owner loses the gesture in the same save (a later change could otherwise be undone).
				beforeSave: (value) => give(owner, value),
				// Drawn again: every menu says again who holds what.
				onChange: () => redraw(),
			});
			say(setting, owner);
		}
		// Your gestures: any command of Obsidian or of a plugin.
		const yours = page.section(page.t("settings.custom"), page.t("settings.custom-desc"));
		cleanCustom(page.settings.custom).forEach((entry, i) => {
			const owner: GestureOwner = { custom: i };
			const name = commandName(page.app, entry.command);
			const row = new Setting(yours.el).setName(name ?? page.t("settings.custom-missing"));
			if (!name) row.setDesc(entry.command);
			row.addDropdown((dropdown) => {
				dropdown.addOptions(choicesFor(owner)).setValue(entry.gesture).onChange((value) => {
					if (stale || gone) return;
					give(owner, value);
					redraw();
				});
			});
			row.addExtraButton((button) => {
				button.setIcon("trash-2").setTooltip(page.t("settings.custom-remove")).onClick(() => {
					if (stale || gone) return;
					page.settings.custom = cleanCustom(page.settings.custom).filter((_, k) => k !== i);
					moved = null;
					redraw();
				});
			});
			say(row, owner);
		});
		new Setting(yours.el).addButton((button) => {
			button.setButtonText(page.t("settings.custom-add")).onClick(() => {
				new CommandPicker(page.app, page.t("settings.custom-pick"), (command) => {
					if (gone) return;
					const list = cleanCustom(page.settings.custom);
					// A gesture nobody holds yet, so that the new line works at once (change it next to it).
					page.settings.custom = [...list, { command, gesture: freeGesture(page.settings, list) }];
					moved = null;
					redraw();
				}).open();
			});
		});
		page.section(page.t("settings.display"))
			.toggle("trail", page.t("settings.trail"), { desc: page.t("settings.trail-desc") });
		// Said once: the next drawing (another change, coming back to the page) shows it no more.
		if (moved === shown) moved = null;
	},
});
