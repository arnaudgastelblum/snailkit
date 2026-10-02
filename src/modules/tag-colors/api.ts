/** Available through Snailkit's service("tag-colors") while the module is enabled. */
export interface TagColorsAPI {
	readonly version: 1;
	/** Tag without #. Sets the four --sk-tag-{r,l}-{bg,fg} variables on your element. */
	classes(tag: string): string;
}
