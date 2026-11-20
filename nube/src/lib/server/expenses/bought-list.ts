import type { ExpenseInput } from 'comun/expenses.ts';
import { inBackground } from '#lib/server/ai-lane.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { setItemsDone, toBuyItems, type Kitchen } from '#lib/server/fridge.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { askedPrompt, byWords, fromAnswer, SCHEMA, SYSTEM, type ListItem } from './bought-match.ts';
import { boughtOf } from './bought.ts';

/**
 * What a purchase has, off the shopping list (#451, phase 2): saved in Gastos, what is on the list
 * and the ticket has is ticked off, as if it had been ticked by hand (it stays, ticked, until
 * «Quitar lo comprado»). By its words at once («tomates» in «TOMATE PERA (Fruta y verdura)»): the
 * page that saved it says so and can put it back. The rest by its meaning («papel higiénico» in
 * «PAPEL HIG SCOTTEX»), in one question to the family's AI, if it has one and `ai`: afterwards,
 * without the page waiting (it went behind the rest of the AI's background, sometimes for long),
 * so those are seen only on the list.
 */

/** Which of `rest` the ticket has by its meaning, ticked off; nothing if there is no AI. */
async function tickByMeaning(k: Kitchen, rest: ListItem[], lines: string[]) {
	const apiKey = await openRouterKey(k);
	if (!apiKey) return;
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
	const hit = fromAnswer(rest, answer);
	if (hit.length)
		await setItemsDone(
			k,
			hit.map((i) => i.id),
			true
		);
}

/** Ticked off, of the list, what `input` has by its words: what was ticked (to put it back). */
export async function tickOffBought(k: Kitchen, input: ExpenseInput, { ai = true } = {}) {
	const list = await toBuyItems(k);
	if (!list.length) return [];
	const lines = boughtOf(0, input).items;
	const words = byWords(list, lines);
	const rest = list.filter((i) => !words.includes(i));
	if (ai && rest.length)
		void tickByMeaning(k, rest, lines).catch((error) =>
			console.warn('[gastos] No se pudo mirar la lista por significado', { error: String(error) })
		);
	return setItemsDone(
		k,
		words.map((i) => i.id),
		true
	);
}
