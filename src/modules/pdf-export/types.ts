// Settings of the PDF export module. Choice settings are plain strings (the settings page
// dropdowns work on strings); the pure helpers fall back to the default on an unknown value.
export interface PdfExportSettings {
	/** "A3" | "A4" | "A5" | "Letter" | "Legal" | "Tabloid" */
	pageSize: string;
	landscape: boolean;
	/** Same margin on the four sides, 0..40 mm. */
	marginMm: number;
	/** Print scale, 50..150 %. */
	scalePercent: number;
	pageNumbers: boolean;
	headerTitle: boolean;
	/** "obsidian" | "light" | "dark" */
	colorScheme: string;
	/** "white" | "theme" */
	pageBackground: string;
	addTitle: boolean;
	/** A line with exactly this text becomes a page break. Empty: off. */
	pageBreakMarker: string;
	/** "none" | "h1" | "h2" */
	pageBreakBefore: string;
	/** "obsidian" | "none" */
	internalLinks: string;
	clickableImages: boolean;
	outline: boolean;
	/** "ask" | "nextToNote" | "folder" */
	saveMode: string;
	outputFolder: string;
	openAfterExport: boolean;
	/** Internal, no row on the settings page: last folder picked in the save dialog. */
	lastSaveDir: string;
}
