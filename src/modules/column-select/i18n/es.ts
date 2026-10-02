import type { StringsOf } from "../../../i18n";
import type { en } from "./en";

export const es: StringsOf<typeof en> = {
	"module.name": "Selección en columna",
	"module.description": "Selecciona una columna de texto y edita varias líneas a la vez.",
	"command.up": "Ampliar la selección en columna hacia arriba",
	"command.down": "Ampliar la selección en columna hacia abajo",
	"command.left": "Ampliar la selección en columna hacia la izquierda",
	"command.right": "Ampliar la selección en columna hacia la derecha",
	"settings.selecting": "Selección",
	"settings.keyboard": "Alt+Mayús+flechas",
	"settings.keyboard-desc": "Selecciona una columna con el teclado. Desactiva para devolver estas teclas a Obsidian; los comandos siguen disponibles.",
	"settings.mouse": "Alt+arrastrar",
	"settings.mouse-desc": "Selecciona una columna con Alt+arrastrar, amplíala con Alt+Mayús+clic o añade y elimina cursores con Alt+clic. Desactiva para usar el comportamiento del ratón de Obsidian. Algunos sistemas Linux usan Alt+arrastrar para mover ventanas.",
	"settings.pasting": "Pegado",
	"settings.paste": "Repartir el portapapeles entre las líneas",
	"settings.paste-desc": "Con varios cursores, pega una línea del portapapeles por línea seleccionada. Una sola línea se repite en todas. Desactiva para usar el pegado habitual de Obsidian.",
	"paste.dropped.one": "No se ha pegado {count} línea adicional del portapapeles.",
	"paste.dropped.other": "No se han pegado {count} líneas adicionales del portapapeles.",
};
