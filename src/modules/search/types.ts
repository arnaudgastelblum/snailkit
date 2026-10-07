// Settings of the Search module, and the contract it publishes as the "search" service (the
// shapes live in core/services.ts, shared with the Home tab and the note rail).
export type {
	InlineSearch,
	InlineSearchHost,
	SearchFilter,
	SearchGroup,
	SearchOpenOptions,
	SearchResult,
	SearchResultKind,
	SearchService,
	SearchSource,
} from "../../core/services";

export interface SearchSettings {
	/** Also search the text of the notes (an index kept in memory on a computer, a direct read on phones). */
	content: boolean;
}

export const DEFAULTS: SearchSettings = {
	content: true,
};
