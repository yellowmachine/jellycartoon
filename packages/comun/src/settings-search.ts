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

/**
 * Words said around what is looked for, «quiero cambiar los colores»: left out, unless only they
 * were typed.
 */
const FILLER = new Set(
	'a al como con cual de del donde el en es esta este hacer la las lo los me mi mis para pongo poner por puedo que quiero quitar se cambiar cambio activar desactivar un una uno y yo tengo ver veo hay'.split(
		' '
	)
);

/** Without its plural: «colores» and «color», «avisos» and «aviso», the same. */
const stem = (word: string) =>
	word.length > 4 && word.endsWith('es')
		? word.slice(0, -2)
		: word.length > 3 && word.endsWith('s')
			? word.slice(0, -1)
			: word;

/** A word typed starts one of `text`'s: «ia» is not in «viajes», «subt» is in «subtítulos». */
const hasWord = (text: string[], w: string) =>
	text.some((t) => t.startsWith(w) || stem(t).startsWith(stem(w)));

/** Looser, for a sentence: also the same first five letters («invito», «invitaciones»). */
const nearWord = (text: string[], w: string) =>
	hasWord(text, w) || (w.length >= 5 && text.some((t) => t.slice(0, 5) === w.slice(0, 5)));

/** Every word typed starts one of `text`'s. */
const has = (text: string[], typed: string[]) => typed.every((w) => hasWord(text, w));

/**
 * The sections with every word typed, in their title, their words or their tab, accents and case
 * aside; those whose title has them first. If none has them all (a sentence, «quiero que me avise
 * el móvil»), those with the most of them. The words around it («quiero», «cómo»…) count only if
 * nothing else was typed.
 */
export function searchSettings<Tab extends string, Shown>(
	index: SettingsEntry<Tab, Shown>[],
	labels: Record<Tab, string>,
	query: string,
	shown: Shown,
	max = 8
): SettingsEntry<Tab, Shown>[] {
	const all = wordsOf(query);
	const meant = all.filter((w) => !FILLER.has(w));
	const typed = meant.length ? meant : all;
	if (!typed.length) return [];
	const visible = index.filter((e) => e.shown?.(shown) ?? true);
	const textOf = (e: SettingsEntry<Tab, Shown>) =>
		wordsOf(`${e.title} ${e.words} ${labels[e.tab]}`);
	const found = visible.filter((e) => has(textOf(e), typed));
	const inTitle = (e: SettingsEntry<Tab, Shown>) => has(wordsOf(e.title), typed);
	if (found.length)
		return [...found.filter(inTitle), ...found.filter((e) => !inTitle(e))].slice(0, max);
	// None with them all: by how many they have, the title's first among equals.
	if (!meant.length || (typed.length < 2 && typed[0]!.length < 5)) return [];
	const score = (e: SettingsEntry<Tab, Shown>) => {
		const text = textOf(e);
		const title = wordsOf(e.title);
		return typed.reduce((n, w) => n + (nearWord(title, w) ? 1.5 : nearWord(text, w) ? 1 : 0), 0);
	};
	return visible
		.map((e) => ({ e, n: score(e) }))
		.filter((x) => x.n > 0)
		.sort((a, b) => b.n - a.n)
		.slice(0, max)
		.map((x) => x.e);
}
