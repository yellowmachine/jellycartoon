import type { Recipe } from 'comun/recipe.ts';
import type { Block } from '#lib/blocks.ts';

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

export type ChatCard = ShoppingCard | RecipeCard | PageCard | BlockCard | ReportCard;

export interface ChatMessage {
	id: number;
	role: 'user' | 'assistant';
	text: string;
	cards: ChatCard[];
	createdAt: Date;
}

/** A question, not a letter. */
export const MAX_CHAT_QUESTION = 2_000;
/** Items in a card: more than this is not a list to tick. */
export const MAX_CARD_ITEMS = 30;
