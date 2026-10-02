import { addIcon } from "obsidian";

/** Snailkit's own icon: Lucide's "snail" (ISC license), redrawn on Obsidian's 100-unit grid. */
export const SNAIL_ICON = "snailkit-snail";

export function registerIcons(): void {
	addIcon(
		SNAIL_ICON,
		`<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0"/>
<circle cx="10" cy="13" r="8"/>
<path d="M2 21h12c4.4 0 8-3.6 8-8V7a2 2 0 1 0-4 0v6"/>
<path d="M18 3 19.1 5.2"/>
<path d="M22 3 20.9 5.2"/>
</g>`,
	);
}
