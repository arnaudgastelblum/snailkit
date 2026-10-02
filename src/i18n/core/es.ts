import type { StringsOf } from "../index";
import type { en } from "./en";

export const es: StringsOf<typeof en> = {
	"plugin.tagline": "Pequeñas herramientas tranquilas para tus notas. Activa solo las que quieras.",
	"plugin.welcome": "Snailkit está instalado. Elige tus herramientas en sus ajustes.",
	"plugin.welcome-action": "Elegir herramientas",
	"plugin.start-error": "Snailkit: {name} no pudo iniciarse. Encontrarás los detalles en sus ajustes.",

	"home.count.one": "{count} de {total} herramientas activada",
	"home.count.other": "{count} de {total} herramientas activadas",
	"home.search": "Buscar una herramienta",
	"home.no-match": "Ninguna herramienta coincide con «{query}».",
	"home.issue": "Informar de un problema",
	"home.version": "Versión {version}",

	"language.label": "Idioma",
	"language.auto": "Automático ({name})",

	"category.write": "Escritura",
	"category.organize": "Organización",
	"category.export": "Exportación",

	"card.settings": "Ajustes",
	"card.open-settings": "Abrir los ajustes de {name}",
	"card.toggle": "Activar o desactivar {name}",
	"card.desktop-only": "Solo escritorio",
	"card.error": "No se inició",
	"card.unavailable": "No disponible",

	"page.back": "Todas las herramientas",
	"page.docs": "Documentación",
	"page.off": "Esta herramienta está desactivada. Sus ajustes se conservan y se aplican en cuanto la actives.",
	"page.unavailable": "Esta herramienta no puede funcionar aquí: {reason}",
	"page.error": "Esta herramienta tuvo un error al iniciarse: {message}",
	"page.no-settings": "Nada que ajustar: esta herramienta funciona en cuanto está activada.",
	"page.reset": "Restablecer valores predeterminados",
	"page.reset-confirm": "Haz clic de nuevo para restablecer",
	"page.reset-done": "Ajustes de {name} restablecidos.",

	"reason.desktop": "necesita la aplicación de escritorio.",

	"common.cancel": "Cancelar",
	"common.confirm": "Confirmar",
	"common.create": "Crear",
	"common.save": "Guardar",
	"common.close": "Cerrar",
	"common.undo": "Deshacer",
	"common.reset": "Restablecer",
	"common.default": "Predeterminado: {value}",
	"common.on": "Activado",
	"common.off": "Desactivado",
};
