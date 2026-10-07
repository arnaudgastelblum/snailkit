// Every Snailkit module, in no particular order (the settings sort them by category and name).
// Adding a module: create src/modules/<id>/ with an index.ts that exports it, then add it here.
import type { AnyModule } from "../core/module";
import { moveText } from "./move-text";
import { pdfExport } from "./pdf-export";
import { noteRail } from "./note-rail";
import { tagColors } from "./tag-colors";
import { tables } from "./tables";
import { tasks } from "./tasks";
import { slashMenu } from "./slash-menu";
import { columnSelect } from "./column-select";
import { slidesExport } from "./slides-export";
import { sessions } from "./sessions";
import { home } from "./home";
import { search } from "./search";

// Erase each module's settings shape at the registry boundary; the host pairs it with its own defaults.
export const MODULES = [moveText, pdfExport, noteRail, tagColors, tables, tasks, slashMenu, columnSelect, slidesExport, sessions, home, search] as unknown as AnyModule[];
