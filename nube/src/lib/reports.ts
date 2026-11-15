import type { BarsBlock } from '#lib/blocks.ts';

/**
 * Informes (#505, phase 3): documents kept in Preguntar → Informes, asked for in the chat. The AI
 * chooses which blocks go and writes the words between them; Seilide takes each block's figures
 * from the database and draws them (a still picture: «Actualizar» takes them again). Only theirs.
 */

/** The blocks a report may have, and what the AI is told of each. */
export const REPORT_BLOCKS = {
	cifras: 'las cifras de esos días: km en coche, paseos, fotos, lo gastado',
	mapa: 'el mapa con los trayectos en coche, los paseos y dónde se hicieron las fotos',
	fotos: 'las fotos, del modo carretera y de los paseos',
	gastos: 'los gastos de esos días, uno a uno y por categoría (se pueden quitar los que no tocan)',
	barras: 'la gráfica de lo gastado mes a mes por categoría, de los meses de esos días',
	agenda: 'lo apuntado en la agenda esos días',
	tiempo: 'el tiempo que hizo cada día donde se estuvo'
} as const;

export type ReportBlockKind = keyof typeof REPORT_BLOCKS;
export const isReportBlockKind = (v: unknown): v is ReportBlockKind =>
	typeof v === 'string' && Object.hasOwn(REPORT_BLOCKS, v);

export interface StatsBlock {
	kind: 'cifras';
	days: number;
	/** Metres and how many. */
	driven: number;
	drives: number;
	walked: number;
	walks: number;
	photos: number;
	/** The expenses of those days, not the fixed ones: their sum leaves out those taken away. */
	expenses: { id: number; total: number }[];
}

export interface MapBlock {
	kind: 'mapa';
	/** The drives' and walks' ways, thinned: [longitude, latitude]. */
	ways: [number, number][][];
	/** The road mode's photos, where they were taken. */
	photos: { id: number; lon: number | null; lat: number | null }[];
	/** Each drive and walk, to open it in its page; reports made before this have none. */
	moves?: MoveRef[];
}

export interface MoveRef {
	from: 'viaje' | 'paseo';
	id: number;
	at: string;
	/** Metres. */
	distance: number;
	destination: string | null;
}

export interface PhotoRef {
	/** A road mode's photo (/viajes/fotos) or a walk's (/paseos/fotos). */
	from: 'viaje' | 'paseo';
	id: number;
	/** ISO time. */
	at: string;
}

export interface PhotosBlock {
	kind: 'fotos';
	photos: PhotoRef[];
	/** Not shown, past the most a report has. */
	more: number;
}

export interface ExpenseRow {
	id: number;
	date: string;
	store: string;
	/** Cents. */
	total: number;
	category: string;
}

export interface ExpensesBlock {
	kind: 'gastos';
	items: ExpenseRow[];
}

export interface AgendaBlock {
	kind: 'agenda';
	days: { day: string; events: string[] }[];
}

export interface WeatherBlock {
	kind: 'tiempo';
	/** Where: the farthest the drives got, or a planned trip's end. */
	place: string | null;
	days: { day: string; code: number; sky: string; min: number; max: number; rain: number }[];
}

export type ReportBlock =
	StatsBlock | MapBlock | PhotosBlock | ExpensesBlock | BarsBlock | AgendaBlock | WeatherBlock;

/**
 * A piece of a report: the AI's words, then a block (or none: only words). `block` null with a
 * kind: nothing to show for it, `empty` says why.
 */
export interface ReportPiece {
	text: string;
	kind: ReportBlockKind | null;
	block: ReportBlock | null;
	empty: string | null;
}

export interface ReportSummary {
	id: number;
	title: string;
	from: string;
	to: string;
	createdAt: Date;
	refreshedAt: Date;
}

export interface Report extends ReportSummary {
	pieces: ReportPiece[];
	/** Expenses taken away by the person («no es del viaje»): kept when it is brought up to date. */
	excluded: number[];
}

/** Days in a report, at most: a long holiday. */
export const REPORT_DAYS = 31;
/** Pieces in a report, at most. */
export const MAX_PIECES = 12;
/** Words between blocks, at most, each. */
export const MAX_PIECE_TEXT = 1_500;
/** Photos in a report, at most. */
export const REPORT_PHOTOS = 60;

/** The expenses kept: all but those taken away. */
export const keptExpenses = <T extends { id: number }>(items: T[], excluded: number[]) =>
	items.filter((e) => !excluded.includes(e.id));
