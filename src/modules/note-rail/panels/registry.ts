// Every panel the rail can open.
import type { PanelDefinition, PanelId, RailPanelId } from "../types";
import { actionsPanel } from "./actions/ActionsPanel";
import { calloutPanel } from "./actions/CalloutPanel";
import { bookmarksPanel } from "./bookmarks/BookmarksPanel";
import { calendarPanel } from "./calendar/CalendarPanel";
import { menuPanel } from "./menu/MenuPanel";
import { placePanel } from "./place/PlacePanel";
import { sessionPanel } from "./session/SessionPanel";
import { tasksPanel } from "./tasks/TasksPanel";
import { tocPanel } from "./toc/TocPanel";

/** The panels the user can show or hide. */
export const PANELS: Record<PanelId, PanelDefinition> = {
	toc: tocPanel,
	bookmarks: bookmarksPanel,
	tasks: tasksPanel,
	calendar: calendarPanel,
};

/** Every panel, by id. */
export const ALL_PANELS: Record<RailPanelId, PanelDefinition> = {
	...PANELS,
	menu: menuPanel,
	session: sessionPanel,
	place: placePanel,
	actions: actionsPanel,
	callout: calloutPanel,
};
