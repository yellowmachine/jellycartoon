import { hasWords } from '#lib/server/voice/learned.ts';

/**
 * Matching a purchase against the shopping list (#451, phase 2), without the database: by words,
 * and the question and answer for the rest by meaning (bought-list.ts asks it).
 */

/** At most this many lines asked: a long ticket's. */
const MAX_LINES = 80;
export const SYSTEM =
	'Dices qué cosas de la lista de la compra de una familia vienen en un ticket de compra. Cada línea del ticket lleva su tipo entre paréntesis; las líneas vienen como las escribe la tienda (abreviadas, con marcas). Una cosa de la lista viene si alguna línea es eso o una forma de eso («leche» y «LECHE SEMI PASCUAL»; «papel higiénico» y «PAPEL HIG SCOTTEX»); si dudas, no.';
export const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['vienen'],
	properties: { vienen: { type: 'array', items: { type: 'integer' } } }
};

export interface ListItem {
	id: number;
	text: string;
}

/** Which of `list` the ticket's `lines` have by their words. */
export const byWords = (list: ListItem[], lines: string[]) =>
	list.filter((item) => lines.some((line) => hasWords([item.text], line)));

/** The question: the list and the ticket, numbered. */
export const askedPrompt = (list: ListItem[], lines: string[]) =>
	`Lista de la compra, numerada:\n${list.map((i, n) => `${n + 1}. ${i.text}`).join('\n')}\n\nTicket:\n${lines.slice(0, MAX_LINES).join('\n')}\n\n¿Qué números de la lista vienen en el ticket?`;

/** The AI's answer, as the list's items: only numbers it has, once each. */
export function fromAnswer(list: ListItem[], answer: unknown) {
	const numbers = (answer as { vienen?: unknown } | null)?.vienen;
	const picked = new Set(
		(Array.isArray(numbers) ? numbers : [])
			.map(Number)
			.filter((n) => Number.isInteger(n) && n >= 1 && n <= list.length)
	);
	return list.filter((_, i) => picked.has(i + 1));
}
