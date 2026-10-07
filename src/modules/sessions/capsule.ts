// Tag capsules come from the shared tag picker.
export { tagCapsule as capsule } from "../../ui/tag-picker/capsule";

/** Keys as <kbd> elements joined with "+", for hints and the shortcut list. */
export function keys(parent: HTMLElement, ...names: string[]): void {
	names.forEach((name, i) => {
		if (i) parent.appendText("+");
		parent.createEl("kbd", { text: name });
	});
}
