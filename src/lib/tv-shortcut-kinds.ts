/**
 * What a TV shortcut can open (#343): a site of elsewhere, as at first (#327), or anything of the
 * TV view's own. Those with a page of their own open it, where the episode, the version or the
 * saved game is chosen; a channel, a station and a Steam game start at once.
 */
export const SHORTCUT_KINDS = {
	url: 'Web',
	serie: 'Serie',
	pelicula: 'Película',
	canal: 'Canal',
	radio: 'Emisora de radio',
	podcast: 'Podcast',
	album: 'Álbum',
	lista: 'Lista de música',
	juego: 'Juego',
	steam: 'Steam'
} as const;

export type ShortcutKind = keyof typeof SHORTCUT_KINDS;

export const isShortcutKind = (kind: string): kind is ShortcutKind =>
	Object.hasOwn(SHORTCUT_KINDS, kind);

/** A Steam shortcut to Big Picture alone, instead of a game. */
export const BIG_PICTURE = 'bigpicture';

/** One to choose in Ajustes (/api/accesos/destinos): what it keeps, and how it is shown. */
export interface Candidate {
	target: string;
	name: string;
	/** The artist, the console…; null, nothing to add. */
	detail: string | null;
}
