import type { StringsOf } from "../../../i18n";
import type { en } from "./en";

export const fr: StringsOf<typeof en> = {
	"module.name": "Sélection en colonne",
	"module.pitch": "Une seule saisie sur plusieurs lignes, même courtes.",
	"demo.gesture": "Alt + glisser · Saisissez sur chaque ligne",
	"module.description": "Sélectionnez une colonne de texte et modifiez plusieurs lignes à la fois.",
	"command.up": "Étendre la sélection en colonne vers le haut",
	"command.down": "Étendre la sélection en colonne vers le bas",
	"command.left": "Étendre la sélection en colonne vers la gauche",
	"command.right": "Étendre la sélection en colonne vers la droite",
	"settings.selecting": "Sélection",
	"settings.keyboard": "Alt+Maj+flèches",
	"settings.keyboard-desc": "Sélectionnez une colonne au clavier. Désactivez pour rendre ces touches à Obsidian ; les commandes restent disponibles.",
	"settings.mouse": "Alt+glisser",
	"settings.mouse-desc": "Sélectionnez une colonne avec Alt+glisser, étendez-la avec Alt+Maj+clic ou ajoutez et retirez des curseurs avec Alt+clic. Désactivez pour retrouver le comportement d'Obsidian. Certains systèmes Linux utilisent Alt+glisser pour déplacer les fenêtres.",
	"settings.pasting": "Collage",
	"settings.paste": "Répartir le presse-papiers sur les lignes",
	"settings.paste-desc": "Avec plusieurs curseurs, collez une ligne du presse-papiers par ligne sélectionnée. Une seule ligne est répétée partout. Désactivez pour utiliser le collage habituel d'Obsidian.",
	"paste.dropped.one": "{count} ligne supplémentaire du presse-papiers n'a pas été collée.",
	"paste.dropped.other": "{count} lignes supplémentaires du presse-papiers n'ont pas été collées.",
};
