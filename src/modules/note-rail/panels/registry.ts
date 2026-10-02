// Every panel the rail can host.
import type { PanelDefinition, PanelId } from "../types";
import { bookmarksPanel } from "./bookmarks/BookmarksPanel";
import { calendarPanel } from "./calendar/CalendarPanel";
import { tasksPanel } from "./tasks/TasksPanel";
import { tocPanel } from "./toc/TocPanel";

export const PANELS: Record<PanelId, PanelDefinition> = {
	toc: tocPanel,
	bookmarks: bookmarksPanel,
	tasks: tasksPanel,
	calendar: calendarPanel,
};
