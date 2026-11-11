import type { Recipe } from 'comun/recipe.ts';

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

export type ChatCard = ShoppingCard | RecipeCard;

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
