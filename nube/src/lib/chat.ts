import type { Recipe } from 'comun/recipe.ts';
import type { Block } from '#lib/blocks.ts';
import type { Cita } from '#lib/cita.ts';
import type { ErrandChangeCard, PlanCard } from '#lib/encargos.ts';
import type { PlugPauseCard, PlugSkipCard } from '#lib/plug-pause.ts';

/**
 * «Preguntar» (#470): what each answer of the chat brings besides its words, as the page shows
 * them. The AI only proposes; nothing is saved until the person taps it.
 */

/** Things to buy: each with its check; `added`, what went onto the list (null, not yet). */
export interface ShoppingCard {
	kind: 'compra';
	items: string[];
	added: string[] | null;
}

/** A recipe written for them: `savedId`, its number in the recipe book once saved. */
export interface RecipeCard {
	kind: 'receta';
	recipe: Recipe;
	savedId: number | null;
}

/**
 * A page of Seilide, already filtered (#504 phase 3): beside the panel, it opens by itself in the
 * main part; elsewhere, a tap opens it.
 */
export interface PageCard {
	kind: 'pagina';
	href: string;
	label: string;
}

/** A chart or other block (#504 phase 3), with the figures it had when it was made. */
export interface BlockCard {
	kind: 'bloque';
	block: Block;
}

/** A report made from the chat (#505), kept in Preguntar → Informes: a tap opens it. */
export interface ReportCard {
	kind: 'informe';
	id: number;
	title: string;
	from: string;
	to: string;
}

/** A plan to propose in Mensajes (#555): only made in its panel, to send. */
export interface EventCard extends Cita {
	kind: 'cita';
}

/** A place the person kept (#151), to send in Mensajes (#555): only made in its panel. */
export interface PlaceCard {
	kind: 'sitio';
	name: string;
	lat: number;
	lon: number;
	address: string | null;
}

export type ChatCard =
	| ShoppingCard
	| RecipeCard
	| PageCard
	| BlockCard
	| ReportCard
	| EventCard
	| PlaceCard
	| PlanCard
	| ErrandChangeCard
	| PlugPauseCard
	| PlugSkipCard;

export interface ChatMessage {
	id: number;
	role: 'user' | 'assistant';
	text: string;
	cards: ChatCard[];
	createdAt: Date;
}

/** The messages sent with each question: enough to follow the thread, not a whole month. */
export const CHAT_HISTORY = 20;
/**
 * Of those, only the last hours': one conversation for every page, and a question today is not
 * read in the light of yesterday's in another section. The person still sees the whole month.
 */
export const CHAT_CONTEXT_MS = 2 * 60 * 60_000;

/**
 * Where the AI starts reading the chat at `now`: the index of the first message it is sent with
 * the next question (the last CHAT_HISTORY, of the last CHAT_CONTEXT_MS). Its length, none.
 */
export function firstRead(messages: Pick<ChatMessage, 'createdAt'>[], now = Date.now()) {
	let i = Math.max(0, messages.length - CHAT_HISTORY);
	while (i < messages.length && now - new Date(messages[i]!.createdAt).getTime() >= CHAT_CONTEXT_MS)
		i++;
	return i;
}

/** A question, not a letter. */
export const MAX_CHAT_QUESTION = 2_000;
/** Items in a card: more than this is not a list to tick. */
export const MAX_CARD_ITEMS = 30;
