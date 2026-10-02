// Shared settings and captured selections for the move actions.
import type { EditorPosition, TFile } from "obsidian";
import type { ModuleContext } from "../../core/context";

export interface MoveTextSettings {
	archiveFolder: string;
	prefixSubnoteName: boolean;
	provenanceLine: boolean;
	dateFormat: string;
}
export type Context = ModuleContext<MoveTextSettings>;
export interface SourceSnapshot { source: string; isCurrent?: () => boolean }
export interface Block extends SourceSnapshot { start: number; end: number; lines: string[] }
export interface SelectionRange extends SourceSnapshot { from: EditorPosition; to: EditorPosition; endLine: number; raw: string }
export type Payload = { block: Block; range?: never; text: string } | { block?: never; range: SelectionRange; text: string };
export type ExtractTarget = { type: "create"; name: string } | { type: "append"; file: TFile };
export type AppendTarget = { type: "create"; path: string } | { type: "file"; file: TFile };
