/**
 * «¿Qué hago con este enlace?» (#633): what to offer, the likeliest first. Each place a link may go
 * says here when it is the likely one; a new one is one more here and its card on the page.
 * Mensajes, always, after them.
 */
export const LINK_PLACES = ['podcast', 'receta', 'deseos', 'notas'] as const;
export type LinkPlace = (typeof LINK_PLACES)[number];

export function linkOrder(is: {
	/** A known shop's, or a product with its price read by the bookmark. */
	wish: boolean;
	recipe: boolean;
	podcast: boolean;
	/** In some list of wishes they write in; Notas is the grown-ups'. */
	canWish: boolean;
	canNote: boolean;
}): LinkPlace[] {
	const can: Record<LinkPlace, boolean> = {
		podcast: is.podcast,
		receta: true,
		deseos: is.canWish,
		notas: is.canNote
	};
	const first: LinkPlace = is.podcast
		? 'podcast'
		: is.recipe
			? 'receta'
			: is.wish && is.canWish
				? 'deseos'
				: is.canNote
					? 'notas'
					: 'receta';
	return [first, ...LINK_PLACES.filter((p) => p !== first)].filter((p) => can[p]);
}
