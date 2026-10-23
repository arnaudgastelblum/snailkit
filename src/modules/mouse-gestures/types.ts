import type { CustomGesture, GestureMap } from "./logic";

/** The gesture of each action ("" = off), whether the line shows while drawing, and the gestures given to any command. */
export interface MouseGesturesSettings extends GestureMap {
	trail: boolean;
	custom: CustomGesture[];
}
