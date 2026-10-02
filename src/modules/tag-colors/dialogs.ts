import { Modal, Setting } from "obsidian";
import { assignSlots, buildCss, capsule, hexToHue, hueClasses, oklchToSrgb, slotHue, tagHues, tagKey } from "./colors";
import { frequencies, registry, type ColorHost } from "./types";

export function classes(host: ColorHost, tag: string): string {
	return hueClasses(tagHues(tag, registry(host.settings, "slots"), registry(host.settings, "overrides")));
}

export async function setOverride(host: ColorHost, tag: string, hue: number | null): Promise<void> {
	const colors = registry(host.settings, "overrides");
	if (hue === null) delete colors[tagKey(tag)];
	else Object.defineProperty(colors, tagKey(tag), { value: hue, enumerable: true, configurable: true, writable: true });
	host.settings.overrides = Object.entries(colors);
	await host.save();
}

export class ColorModal extends Modal {
	constructor(private host: ColorHost, private tag: string, private done: () => void = () => {}) {
		super(host.app);
		this.tag = tagKey(tag);
	}
	onOpen(): void {
		const { host, contentEl: el } = this;
		el.addClass("sk-tag-colors-modal");
		el.createEl("h2", { text: host.t("color.title", { tag: this.tag }) });
		// Dialogs also work while the module is off; their palette is scoped to their content.
		el.createEl("style").textContent = buildCss(Array.from({ length: 14 }, (_, i) => slotHue(i)))
			.replace(/ \.sk-tag-colors-/g, " .sk-tag-colors-modal .sk-tag-colors-");
		const save = async (hue: number | null) => {
			await setOverride(host, this.tag, hue);
			this.close();
			this.done();
		};
		const swatches = el.createDiv({ cls: "sk-tag-colors-swatches" });
		for (let slot = 0; slot < 14; slot++) {
			const hue = slotHue(slot);
			const button = swatches.createEl("button", { attr: { "aria-label": host.t("color.hue", { hue: Math.round(hue) }) } });
			button.append(capsule(el.ownerDocument, host.t("color.sample"), hueClasses({ rootHue: hue, leafHue: hue })));
			button.onclick = () => { void save(hue); };
		}
		const setting = new Setting(el).setName(host.t("color.custom")).setDesc(host.t("color.custom-desc"));
		const input = setting.controlEl.createEl("input", { type: "color", attr: { "aria-label": host.t("color.custom") } });
		const hue = tagHues(this.tag, registry(host.settings, "slots"), registry(host.settings, "overrides")).leafHue;
		input.value = "#" + oklchToSrgb(.65, .15, hue).map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
		input.onchange = () => { void save(hexToHue(input.value)); };
		new Setting(el).addButton(button => button.setButtonText(host.t("color.automatic")).onClick(() => save(null)));
	}
	onClose(): void { this.contentEl.empty(); }
}

export class ReassignModal extends Modal {
	constructor(private host: ColorHost, private done: () => void = () => {}) { super(host.app); }
	onOpen(): void {
		this.contentEl.addClass("sk-tag-colors-modal");
		this.contentEl.createEl("p", { text: this.host.t("reassign.confirm") });
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText(this.host.t("common.cancel")).onClick(() => this.close()))
			.addButton(button => button.setButtonText(this.host.t("common.confirm")).setWarning().onClick(async () => {
				this.host.settings.slots = Object.entries(assignSlots({}, frequencies(this.host.app)));
				await this.host.save();
				this.close();
				this.done();
			}));
	}
	onClose(): void { this.contentEl.empty(); }
}
