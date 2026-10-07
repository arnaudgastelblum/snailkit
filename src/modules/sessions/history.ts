// The editor's undo history, as Obsidian ships it. Cast to the types of our @codemirror/state
// (the copy nested under @codemirror/commands in node_modules differs only in its typings).
import * as commands from "@codemirror/commands";
import type { AnnotationType, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const undo = commands.undo as unknown as (view: EditorView) => boolean;
export const undoDepth = commands.undoDepth as unknown as (state: EditorState) => number;
export const isolateHistory = commands.isolateHistory as unknown as AnnotationType<"before" | "after" | "full">;
