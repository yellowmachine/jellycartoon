import { fold } from './music.ts';

/**
 * Finding a section of Ajustes by a word (#178), in the house and in the cloud (#253): each app
 * has its own index of sections (their tab, and words one might look for them by, also those they
 * do not say), as the page only draws the open tab.
 */

export interface SettingsEntry<Tab extends string = string, Shown = unknown> {
	/** The section's `id` on the page: `?seccion=<tab>#<id>`. */
	id: string;
	tab: Tab;
	title: string;
	words: string;
	/** Only where the page shows it, by its data. */
	shown?: (d: Shown) => boolean;
}

/** Its words, accents and case aside. */
const wordsOf = (text: string) =>
	fold(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/** Every word typed starts one of `text`'s: «ia» is not in «viajes», «subt» is in «subtítulos». */
const has = (text: string[], typed: string[]) =>
	typed.every((w) => text.some((t) => t.startsWith(w)));

/**
 * The sections with every word typed, in their title, their words or their tab, accents and case
 * aside; those whose title has them first.
 */
export function searchSettings<Tab extends string, Shown>(
	index: SettingsEntry<Tab, Shown>[],
	labels: Record<Tab, string>,
	query: string,
	shown: Shown,
	max = 8
): SettingsEntry<Tab, Shown>[] {
	const typed = wordsOf(query);
	if (!typed.length) return [];
	const found = index
		.filter((e) => e.shown?.(shown) ?? true)
		.filter((e) => has(wordsOf(`${e.title} ${e.words} ${labels[e.tab]}`), typed));
	const inTitle = (e: SettingsEntry<Tab, Shown>) => has(wordsOf(e.title), typed);
	return [...found.filter(inTitle), ...found.filter((e) => !inTitle(e))].slice(0, max);
}
