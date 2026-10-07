import type { NoteRailService } from "../../core/services";
import { mountPinManager, type PinsRowOptions } from "../note-rail/pin-manager";

/** Owns its DOM and subscription. Call destroy when the view or service goes away. */
export function mountPinsRow(el: HTMLElement, rail: NoteRailService, opts: PinsRowOptions): { update(): void; destroy(): void } {
	return mountPinManager(el, rail, opts, true);
}
