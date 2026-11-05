/** Available through Snailkit's service("tag-colors") while the module is enabled. */
export interface TagColorsAPI {
	readonly version: 1;
	/** Tag without #. Sets the four --sk-tag-{r,l}-{bg,fg} variables on your element. */
	classes(tag: string): string;
	/** Since 2026-11-04: opens the color window of this tag (a root tag colors the root of its whole family); `done` once a color is chosen. */
	chooseColor?(tag: string, done?: () => void): void;
}
