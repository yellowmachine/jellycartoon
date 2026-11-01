import { dayName, localDay } from 'comun/agenda.ts';

/**
 * What a proposed rule stands on (#331, phase 7): the phrases the AI says repeat, looked for
 * among what was really said. Without three orders behind it, it is not offered: on 2026-10-31 it
 * proposed «si recuerdas algo, pon la nevera» out of nothing.
 */

/** Said fewer times than this, it does not repeat. */
export const MIN_REPEATS = 3;
/** Days named in the Buzón, at most. */
const MAX_DAYS = 5;

const plain = (text: string) =>
	text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9ñ ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * The orders behind `phrases`: each one said that has one of them in it (or is in one). Null if
 * fewer than `MIN_REPEATS`, or if one of the phrases was never said (made up). With why, to be
 * read in the Buzón: «porque dijiste «pongo la lavadora» (lunes 26, miércoles 28, viernes 30)».
 */
export function repeatsOf(said: { text: string; at: Date }[], phrases: string[]) {
	const wanted = [...new Set(phrases.map(plain).filter((p) => p.length >= 3))];
	if (!wanted.length) return null;
	const heard = said.map((h) => ({ ...h, plain: plain(h.text) }));
	// Said in it, or it the whole order; not a «vale» inside a long phrase.
	const matches = (h: { plain: string }, p: string) =>
		h.plain.includes(p) || (h.plain.length >= 8 && p.includes(h.plain));
	if (!wanted.every((p) => heard.some((h) => matches(h, p)))) return null;
	const behind = heard.filter((h) => wanted.some((p) => matches(h, p)));
	if (behind.length < MIN_REPEATS) return null;
	const days = [...new Set(behind.map((h) => localDay(h.at)))]
		.slice(-MAX_DAYS)
		.map((d) => dayName(d));
	const first = phrases.find((p) => plain(p).length >= 3)!.trim();
	return {
		count: behind.length,
		because: `porque dijiste «${first}»${wanted.length > 1 ? ' y parecidas' : ''} (${days.join(', ')})`
	};
}
