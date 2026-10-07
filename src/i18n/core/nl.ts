import type { StringsOf } from "../index";
import type { en } from "./en";

export const nl: StringsOf<typeof en> = {
	"plugin.tagline": "Kleine, rustige tools voor je notities. Zet alleen aan wat je nodig hebt.",
	"plugin.welcome": "Snailkit is geïnstalleerd. Kies je tools in de instellingen.",
	"plugin.welcome-action": "Tools kiezen",
	"plugin.start-error": "Snailkit: {name} kon niet starten. Meer details in de instellingen ervan.",

	"home.count.one": "{count} van de {total} tools staat aan",
	"home.count.other": "{count} van de {total} tools staan aan",
	"home.search": "Zoek een tool",
	"home.no-match": "Geen tool gevonden voor “{query}”.",
	"home.issue": "Een probleem melden",
	"home.version": "Versie {version}",

	"language.label": "Taal",
	"language.auto": "Automatisch ({name})",

	"category.write": "Schrijven",
	"category.organize": "Ordenen",
	"category.export": "Exporteren",

	"card.settings": "Instellingen",
	"card.open-settings": "Instellingen van {name} openen",
	"card.toggle": "{name} aan- of uitzetten",
	"card.desktop-only": "Alleen desktop",
	"card.error": "Niet gestart",
	"card.unavailable": "Niet beschikbaar",

	"page.back": "Alle tools",
	"page.docs": "Documentatie",
	"page.off": "Deze tool staat uit. De instellingen blijven bewaard en gelden zodra je hem aanzet.",
	"page.unavailable": "Deze tool werkt hier niet: {reason}",
	"page.error": "Deze tool kreeg een fout bij het starten: {message}",
	"page.no-settings": "Niets in te stellen: deze tool werkt zodra hij aanstaat.",
	"page.reset": "Standaardwaarden herstellen",
	"page.reset-confirm": "Klik nogmaals om te herstellen",
	"page.reset-done": "Instellingen van {name} hersteld.",

	"reason.desktop": "hij heeft de desktop-app nodig.",

	"workbench.title": "Werkbank",
	"workbench.tabs-hint": "Je andere tools vind je hier: wissel met deze tabbladen.",
	"workbench.empty.title": "Hier staat nog niets",
	"workbench.empty.text": "De werkbank bundelt de tabbladen van Start, Taken en Brainstorm. Zet een van die tools aan in de instellingen van Snailkit.",
	"workbench.empty.action": "Instellingen openen",

	"common.cancel": "Annuleren",
	"common.confirm": "Bevestigen",
	"common.create": "Aanmaken",
	"common.save": "Opslaan",
	"common.close": "Sluiten",
	"common.undo": "Ongedaan maken",
	"common.reset": "Herstellen",
	"common.default": "Standaard: {value}",
	"common.on": "Aan",
	"common.off": "Uit",
};
