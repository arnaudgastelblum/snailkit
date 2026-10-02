import type { StringsOf } from "../../../i18n";
import type { en } from "./en";

export const nl: StringsOf<typeof en> = {
	"module.name": "Kolomselectie",
	"module.description": "Selecteer een tekstkolom en bewerk meerdere regels tegelijk.",
	"command.up": "Kolomselectie naar boven uitbreiden",
	"command.down": "Kolomselectie naar beneden uitbreiden",
	"command.left": "Kolomselectie naar links uitbreiden",
	"command.right": "Kolomselectie naar rechts uitbreiden",
	"settings.selecting": "Selecteren",
	"settings.keyboard": "Alt+Shift+pijltjes",
	"settings.keyboard-desc": "Selecteer een kolom met je toetsenbord. Schakel uit om deze toetsen weer aan Obsidian over te laten; de opdrachten blijven beschikbaar.",
	"settings.mouse": "Alt+slepen",
	"settings.mouse-desc": "Selecteer een kolom met Alt+slepen, breid deze uit met Alt+Shift+klikken of voeg cursors toe en verwijder ze met Alt+klikken. Schakel uit voor het muisgedrag van Obsidian. Sommige Linux-systemen gebruiken Alt+slepen om vensters te verplaatsen.",
	"settings.pasting": "Plakken",
	"settings.paste": "Klembord over de regels verdelen",
	"settings.paste-desc": "Met meerdere cursors plak je één klembordregel per geselecteerde regel. Eén regel wordt overal herhaald. Schakel uit om de normale plakfunctie van Obsidian te gebruiken.",
	"paste.dropped.one": "{count} extra klembordregel is niet geplakt.",
	"paste.dropped.other": "{count} extra klembordregels zijn niet geplakt.",
};
