/**
 * A recipe's ingredients as things to buy: «Harina (200 g)», the shopping card's way (the chat's,
 * #470), so what is already on the list is seen as such. `usual`, what nearly every house has
 * (salt, oil): shown, but not ticked at first.
 */
export interface RecipeShoppingItem {
	item: string;
	usual: boolean;
}
