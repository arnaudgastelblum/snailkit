// Search: one search for everything Snailkit knows (notes, sections, tasks, brainstorms,
// domains, tags, note content), from the rail's magnifier, the Home tab's field and a command.
import { defineModule } from "../../core/module";
import { DEFAULTS, type SearchSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";
import { Sources } from "./sources";
import { SearchView, openFloating } from "./view";
import { parseQuery } from "./engine";
import type { SearchService } from "./types";

export const search = defineModule<SearchSettings>({
	id: "search",
	icon: "search",
	category: "organize",
	strings: { en, fr, nl, es },
	defaults: DEFAULTS,
	activate(ctx) {
		const sources = new Sources(ctx), views = new Set<SearchView>(), queries = new Set<AbortController>();
		let close: (() => void) | null = null;
		const service: SearchService = {
			version: 1,
			open(options = {}) { close?.(); close = openFloating(sources, options, () => { close = null; }); },
			attach(host) {
				const view = new SearchView(sources, host, false, navigated => view.clear(!navigated)); views.add(view);
				const destroy = view.destroy.bind(view); view.destroy = () => { views.delete(view); destroy(); }; return view;
			},
			async query(text, options = {}) {
				if (sources.stopped) return [];
				const controller = new AbortController(); queries.add(controller);
				try {
					await sources.ensureReady();
					if (controller.signal.aborted) return [];
					const groups = sources.titles(text, options);
					if (options.filter === "tasks" || options.filter === "brainstorms") return groups;
					return [...groups, ...await sources.textResults(parseQuery(text, sources.tags()), controller.signal, options.limit)];
				} finally { queries.delete(controller); }
			},
		};
		ctx.register(() => { close?.(); views.forEach(view => view.destroy()); queries.forEach(query => query.abort()); });
		ctx.provide("search", service);
		ctx.addCommand({ id: "open", name: "Search", callback: () => service.open() });
	},
	settings(page) {
		page.section(page.t("module.name")).toggle("content", page.t("settings.content"), { desc: page.t("settings.content-desc") });
	},
});
