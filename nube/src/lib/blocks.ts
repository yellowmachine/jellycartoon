/**
 * Blocks (#504 phase 3, #505): what the AI may show, drawn by Seilide with its own components and
 * the database's figures, never by the AI. A block is kept as it was made (a still picture, as a
 * report's): the chat's answer and, later, a report's pieces.
 */

/** Stacked bars: one column per label (a month), one segment per series; cents. */
export interface BarsBlock {
	kind: 'barras';
	title: string;
	/** The columns, in order: `YYYY-MM`. */
	labels: string[];
	/** At most SERIES_MAX; the rest folded into the last one («Resto»). */
	series: { name: string; values: number[] }[];
}

export type Block = BarsBlock;

/** Series with a colour of their own: more, and the smallest go into «Resto». */
export const SERIES_MAX = 7;
export const REST = 'Resto';

/**
 * The series' colours, in this order and never cycled: the dataviz skill's categorical palette,
 * dark steps (Seilide is always dark), validated against the cards' zinc-900 (#18181b): all checks
 * pass (worst adjacent CVD ΔE 8.4, normal 19.3, all ≥ 3:1). «Resto», a neutral grey.
 */
export const SERIES_COLORS = [
	'#3987e5',
	'#d95926',
	'#199e70',
	'#c98500',
	'#d55181',
	'#0ca30c',
	'#9085e9'
] as const;
export const REST_COLOR = '#71717a';

export const seriesColor = (name: string, index: number) =>
	name === REST ? REST_COLOR : (SERIES_COLORS[index] ?? REST_COLOR);
