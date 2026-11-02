/** What Ajustes' sections share (#178): their box, fields and buttons. */

export const section = 'mb-8 rounded-md border border-zinc-800 p-4';
/** A group's title over its sections («Ver y escuchar»), as in Seilide's Ajustes. */
export const group =
	'mt-10 mb-3 text-xs font-semibold tracking-wide text-zinc-500 uppercase first-of-type:mt-0';
export const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
export const primary =
	'rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
export const secondary = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';

/** OpenRouter's balance: e.g. `7,40 $`. */
export const dollars = (n: number) =>
	n.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
