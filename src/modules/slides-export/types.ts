import type { ItemView, TFile } from "obsidian";
import type { Rectangle, SceneElement } from "./logic";

export interface SlidesSettings {
	slideSize: string;
	imageWidth: string;
	theme: string;
	withBackground: boolean;
	saveMode: string;
	outputFolder: string;
	lastSaveDir: string;
}

export type DrawingView = ItemView & { file: TFile };
export interface Automate {
	setView(view: DrawingView): void;
	getViewElements(): SceneElement[];
	getExcalidrawAPI(): { getAppState(): { theme: string; viewBackgroundColor: string } };
	createViewPNG(options: {
		withBackground: boolean;
		theme: string;
		frameRendering: { enabled: boolean; name: boolean; outline: boolean; clip: boolean };
		padding: number;
		selectedOnly: boolean;
		embedScene: boolean;
		exportArea: Rectangle;
		scale: number;
	}): Promise<Blob | undefined>;
}
