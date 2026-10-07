export interface SlideSize { cx: number; cy: number }
export interface Placement extends SlideSize { x: number; y: number }
export interface Rectangle { x: number; y: number; width: number; height: number }
export interface SceneElement extends Rectangle {
	id: string;
	type: string;
	name?: string | null;
	isDeleted?: boolean;
	customData?: { slideshow?: unknown };
}
export interface Slide extends Rectangle { id: string; title: string }

// PowerPoint dimensions in EMU, 914400 per inch.
export const SLIDE_SIZES: Record<string, SlideSize> = {
	"16:9": { cx: 12192000, cy: 6858000 },
	"16:10": { cx: 12192000, cy: 7620000 },
	"4:3": { cx: 9144000, cy: 6858000 },
};

export function readSlideshowData(customData?: { slideshow?: unknown }): { order: number; excluded: boolean } | null {
	const value = customData?.slideshow;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const data = value as Record<string, unknown>;
	if (data.kind !== undefined && data.kind !== "frame") return null;
	return {
		order: typeof data.order === "number" && Number.isFinite(data.order) ? data.order : 0,
		excluded: data.excluded === true,
	};
}

export function frameTitle(frame: { name?: string | null }, index: number): string {
	return frame.name || `Frame ${String(index + 1).padStart(2, "0")}`;
}

export function orderFrames(frames: SceneElement[]) {
	const indexed = frames.map((frame, index) => ({ frame, index, title: frameTitle(frame, index), meta: readSlideshowData(frame.customData) }));
	return indexed.sort((a, b) => {
		if (a.meta && b.meta) return a.meta.order - b.meta.order || a.index - b.index;
		if (a.meta || b.meta) return a.meta ? -1 : 1;
		return a.title === b.title ? a.index - b.index : a.title > b.title ? 1 : -1;
	});
}

export function buildSlides(elements: SceneElement[]): Slide[] {
	return orderFrames(elements.filter((el) => el.type === "frame" && !el.isDeleted))
		.filter((entry) => !entry.meta?.excluded)
		.map(({ frame, title }) => ({ id: frame.id, title, ...exportAreaFor(frame) }));
}

export function exportAreaFor(frame: Rectangle): Rectangle {
	return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

export function validRectangle(rect: Rectangle): boolean {
	return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

export function renderScale(area: Pick<Rectangle, "width" | "height">, size: SlideSize, imageWidth: number): number {
	return Math.min(imageWidth / area.width, (imageWidth * size.cy / size.cx) / area.height);
}

export function placeImage(width: number, height: number, size: SlideSize): Placement {
	const scale = Math.min(size.cx / width, size.cy / height);
	const cx = Math.round(width * scale);
	const cy = Math.round(height * scale);
	return { x: Math.round((size.cx - cx) / 2), y: Math.round((size.cy - cy) / 2), cx, cy };
}

export function presentationTitle(file: { basename: string }): string {
	return file.basename.replace(/\.excalidraw$/i, "") || "Presentation";
}

export function withPptxExtension(path: string): string {
	return /\.pptx$/i.test(path) ? path : `${path}.pptx`;
}

export function folderPath(value: string): string {
	return value.trim().replace(/\\/g, "/").split("/").filter((part) => part && part !== ".").join("/");
}

export function validFolder(value: string): boolean {
	return !value.split("/").some((part) => part === ".." || /[:*?"<>|]/.test(part) || Array.from(part).some(char => char.charCodeAt(0) < 32));
}

export function vaultPptxPath(folder: string, basename: string): string {
	const clean = folderPath(folder);
	return `${clean ? clean + "/" : ""}${presentationTitle({ basename })}.pptx`;
}
