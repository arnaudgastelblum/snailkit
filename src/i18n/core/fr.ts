import type { StringsOf } from "../index";
import type { en } from "./en";

export const fr: StringsOf<typeof en> = {
	"plugin.tagline": "De petits outils calmes pour vos notes. N'activez que ceux qui vous servent.",
	"plugin.welcome": "Snailkit est installé. Choisissez vos outils dans ses réglages.",
	"plugin.welcome-action": "Choisir les outils",
	"plugin.start-error": "Snailkit : {name} n'a pas pu démarrer. Le détail est dans ses réglages.",

	"home.count.one": "{count} outil activé sur {total}",
	"home.count.other": "{count} outils activés sur {total}",
	"home.search": "Chercher un outil",
	"home.no-match": "Aucun outil ne correspond à « {query} ».",
	"home.issue": "Signaler un problème",
	"home.version": "Version {version}",

	"language.label": "Langue",
	"language.auto": "Automatique ({name})",

	"category.write": "Écriture",
	"category.organize": "Organisation",
	"category.export": "Export",

	"card.settings": "Réglages",
	"card.open-settings": "Ouvrir les réglages de {name}",
	"card.toggle": "Activer ou désactiver {name}",
	"card.desktop-only": "Ordinateur uniquement",
	"card.error": "N'a pas démarré",
	"card.unavailable": "Indisponible",

	"page.back": "Tous les outils",
	"page.docs": "Documentation",
	"page.off": "Cet outil est désactivé. Ses réglages sont conservés et s'appliquent dès que vous l'activez.",
	"page.unavailable": "Cet outil ne peut pas fonctionner ici : {reason}",
	"page.error": "Cet outil a rencontré une erreur au démarrage : {message}",
	"page.no-settings": "Rien à régler : cet outil fonctionne dès qu'il est activé.",
	"page.reset": "Rétablir les valeurs par défaut",
	"page.reset-confirm": "Cliquez encore pour rétablir",
	"page.reset-done": "Réglages de {name} rétablis.",

	"reason.desktop": "il a besoin de l'application pour ordinateur.",

	"workbench.title": "Atelier",
	"workbench.tabs-hint": "Vos autres outils sont ici : passez de l'un à l'autre avec ces onglets.",
	"workbench.empty.title": "Rien ici pour l'instant",
	"workbench.empty.text": "L'atelier rassemble les onglets d'Accueil, de Tâches et de Brainstorm. Activez l'un de ces outils dans les réglages de Snailkit.",
	"workbench.empty.action": "Ouvrir les réglages",

	"common.cancel": "Annuler",
	"common.confirm": "Confirmer",
	"common.create": "Créer",
	"common.save": "Enregistrer",
	"common.close": "Fermer",
	"common.undo": "Annuler",
	"common.reset": "Rétablir",
	"common.default": "Par défaut : {value}",
	"common.on": "Activé",
	"common.off": "Désactivé",
};
