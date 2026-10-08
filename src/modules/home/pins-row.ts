import type { NoteRailService } from "../../core/services";
import { mountPinManager, type PinsRowOptions } from "../note-rail/pin-manager";

/** Owns its DOM and subscription. Call destroy when the view or service goes away. */
export function mountPinsRow(el: HTMLElement, rail: NoteRailService, opts: PinsRowOptions): { update(): void; destroy(): void } {
	const mark = () => el.querySelectorAll<HTMLElement>("[data-pin-item]").forEach((item) => item.setAttr("data-sk-item", ""));
	const manager = mountPinManager(el, rail, opts, true);
	const observer = new MutationObserver(mark);
	observer.observe(el, { childList: true, subtree: true });
	mark();
	return {
		update: () => { manager.update(); mark(); },
		destroy: () => { observer.disconnect(); manager.destroy(); },
	};
}
