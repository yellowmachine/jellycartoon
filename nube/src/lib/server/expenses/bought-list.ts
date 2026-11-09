import type { ExpenseInput } from 'comun/expenses.ts';
import { inBackground } from '#lib/server/ai-lane.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { setItemsDone, toBuyItems, type Kitchen } from '#lib/server/fridge.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { askedPrompt, byWords, fromAnswer, SCHEMA, SYSTEM, type ListItem } from './bought-match.ts';
import { boughtOf } from './expenses.ts';

/**
 * What a purchase has, off the shopping list (#451, phase 2): saved in Gastos, what is on the list
 * and the ticket has is ticked off, as if it had been ticked by hand (it stays, ticked, until
 * «Quitar lo comprado»; the page that saved it can put it back). By its words first («tomates» in
 * «TOMATE PERA (Fruta y verdura)»); the rest by its meaning («papel higiénico» in «PAPEL HIG
 * SCOTTEX»), in one question to the family's AI, if it has one and `ai`; else by words only.
 */

/** Which of `list` the ticket has: by words, and the rest by meaning if `ai`. */
async function found(k: Kitchen, list: ListItem[], lines: string[], ai: boolean) {
	const words = byWords(list, lines);
	const rest = list.filter((i) => !words.includes(i));
	if (!ai || !rest.length) return words;
	const apiKey = await openRouterKey(k);
	if (!apiKey) return words;
	try {
		const answer = await inBackground(() =>
			completeJson<unknown>({
				apiKey,
				label: 'Tachar de la lista lo comprado',
				system: SYSTEM,
				prompt: askedPrompt(rest, lines),
				name: 'list',
				schema: SCHEMA,
				maxTokens: 200,
				timeoutMs: 15_000
			})
		);
		return [...words, ...fromAnswer(rest, answer)];
	} catch (error) {
		console.warn('[gastos] No se pudo mirar la lista por significado', { error: String(error) });
		return words;
	}
}

/** Ticked off, of the list, what `input` has: what was ticked (to put it back). */
export async function tickOffBought(k: Kitchen, input: ExpenseInput, { ai = true } = {}) {
	const list = await toBuyItems(k);
	if (!list.length) return [];
	const lines = boughtOf(0, input).items;
	const hit = await found(k, list, lines, ai);
	return setItemsDone(
		k,
		hit.map((i) => i.id),
		true
	);
}
