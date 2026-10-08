// Note rail: a quiet row of icons on every note, each opening a sliding panel (Contents, Bookmarks,
// Open tasks, Calendar, and Idea sessions with that module). The rail and panels live in rail/ and panels/, the controller keeps them
// on every note pane.
import { defineModule } from "../../core/module";
import { buildDemo } from "./demo";
import { richText, type SettingsPage } from "../../ui/settings-page";
import { NoteRailController } from "./controller";
import { getDailyConfig } from "./panels/calendar/daily";
import { DEFAULT_SETTINGS, moveInOrder, railOrder, SHOW_KEY } from "./settings";
import type { NoteRailSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";
import { moment } from "../../core/moment";

export const noteRail = defineModule<NoteRailSettings>({
	id: "note-rail",
	icon: "panel-left",
	category: "notes",
	strings: { en, fr, nl, es },
	demo: (el, t) => buildDemo(el, t),
	defaults: DEFAULT_SETTINGS,
	keepOnReset: ["vaultPins", "vaultPinFolders", "bookmarksTips"],
	activate(ctx) {
		new NoteRailController(ctx).start();
	},
	settings(page) {
		railSection(page);

		const contents = page.section(page.t("panel.toc"));
		contents.toggle("tocHoverPreview", page.t("settings.hover"), { desc: page.t("settings.hover-desc") });
		contents.number("tocHoverDelay", page.t("settings.delay"), { desc: page.t("settings.delay-desc"), min: 0, max: 500, step: 10, unit: " ms" });
		contents.number("tocMaxLevel", page.t("settings.level"), { desc: page.t("settings.level-desc"), min: 1, max: 6 });

		page.section(page.t("panel.bookmarks"))
			.text("pinsKey", page.t("settings.pins-key"), {
				desc: page.t("settings.pins-key-desc"),
				placeholder: "pins",
				normalize: (value) => value.trim() || "pins",
			});

		const tasks = page.section(page.t("panel.tasks"));
		tasks.toggle("tasksIncludePinned", page.t("settings.tasks-pinned"), { desc: page.t("settings.tasks-pinned-desc") });
		tasks.toggle("tasksIncludeVaultPins", page.t("settings.tasks-vault"), { desc: page.t("settings.tasks-vault-desc") });
		tasks.toggle("tasksBadge", page.t("settings.tasks-badge"), { desc: page.t("settings.tasks-badge-desc") });
		tasks.toggle("badgeOverdue", page.t("settings.badge-overdue"), { desc: page.t("settings.badge-overdue-desc") });

		calendarSection(page);
	},
});

/** Buttons (shown or not, in order), position, opacity, make room. */
function railSection(page: SettingsPage<NoteRailSettings>): void {
	const rail = page.section(page.t("settings.rail"), page.t("settings.rail-desc"));
	rail.toggle("showPlace", page.t("settings.show-place"), { desc: page.t("settings.show-place-desc") });
	rail.toggle("showToday", page.t("rail.today"), { desc: page.t("settings.show-today-desc") });
	rail.toggle("showSession", page.t("rail.session"), { desc: page.t("settings.show-session-desc") });
	const order = railOrder(page.settings.buttonOrder);
	order.forEach((id, index) => {
		const row = rail.toggle(SHOW_KEY[id], page.t(`panel.${id}`), { desc: page.t(`settings.button-${id}`) });
		for (const step of [-1, 1] as const) {
			row.addExtraButton((button) => button
				.setIcon(step < 0 ? "arrow-up" : "arrow-down")
				.setTooltip(page.t(step < 0 ? "settings.move-up" : "settings.move-down"))
				.setDisabled(index + step < 0 || index + step >= order.length)
				.onClick(async () => {
					page.settings.buttonOrder = moveInOrder(railOrder(page.settings.buttonOrder), id, step);
					await page.save();
					page.refresh();
				}));
		}
	});
	rail.dropdown("position", page.t("settings.position"), {
		left: page.t("settings.position-left"),
		right: page.t("settings.position-right"),
	}, { desc: page.t("settings.position-desc") });
	rail.dropdown("mobilePosition", page.t("settings.mobile-position"), {
		left: page.t("settings.position-left"),
		right: page.t("settings.position-right"),
	}, { desc: page.t("settings.mobile-position-desc") });
	rail.toggle("openOnHover", page.t("settings.hover-open"), { desc: page.t("settings.hover-open-desc") });
	rail.number("restOpacity", page.t("settings.opacity"), { desc: page.t("settings.opacity-desc"), min: 0.2, max: 1, step: 0.05 });
	rail.toggle("makeRoom", page.t("settings.room"), { desc: page.t("settings.room-desc") });
}

/** First day, week numbers, task dots, confirmation, and where daily notes are. */
function calendarSection(page: SettingsPage<NoteRailSettings>): void {
	const calendar = page.section(page.t("panel.calendar"));
	calendar.dropdown("calendarWeekStart", page.t("settings.week-start"), {
		monday: page.t("settings.week-monday"),
		sunday: page.t("settings.week-sunday"),
		language: page.t("settings.week-language"),
	});
	calendar.toggle("calendarWeekNumbers", page.t("settings.week-numbers"), { desc: page.t("settings.week-numbers-desc") });
	calendar.toggle("calendarTaskDots", page.t("settings.task-dots"), { desc: page.t("settings.task-dots-desc") });
	calendar.toggle("calendarConfirmCreate", page.t("settings.confirm"), { desc: page.t("settings.confirm-desc") });

	// What the core Daily notes plugin says, shown as placeholders of the three overrides.
	const core = getDailyConfig(page.app, { calendarFolder: "", calendarFormat: "", calendarTemplate: "" });
	const daily = page.section(page.t("settings.daily"), page.t("settings.daily-desc"));
	daily.text("calendarFolder", page.t("settings.folder"), {
		desc: page.t("settings.folder-desc"),
		placeholder: core.folder || "/",
		normalize: (value) => value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
	});
	const formatDesc = () => page.t("settings.format-desc", {
		date: moment().format(page.settings.calendarFormat.trim() || core.format),
	});
	const formatRow = daily.text("calendarFormat", page.t("settings.format"), {
		desc: formatDesc(),
		placeholder: core.format,
		normalize: (value) => value.trim(),
		onChange: () => { void formatRow.setDesc(richText(formatDesc())); },
	});
	daily.text("calendarTemplate", page.t("settings.template"), {
		desc: page.t("settings.template-desc"),
		placeholder: core.template || page.t("settings.template-none"),
		normalize: (value) => value.trim(),
	});
}
