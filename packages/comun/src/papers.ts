/**
 * The family's Papeles (#384): each with its name, its category, its free notes and its file, a
 * photo or a PDF. Without folders, versions or sharing outside the family.
 */

export const PAPER_CATEGORIES = [
	'Casa',
	'Coche',
	'Seguros',
	'Salud',
	'Trabajo',
	'Estudios',
	'Identidad',
	'Otros'
] as const;

export type PaperCategory = (typeof PAPER_CATEGORIES)[number];

export const isPaperCategory = (value: unknown): value is PaperCategory =>
	PAPER_CATEGORIES.includes(value as PaperCategory);

export interface PaperInput {
	/** «Contrato de alquiler». */
	name: string;
	category: PaperCategory;
	/** Free text: «lo renovamos en marzo, la fianza son dos meses». Empty, none. */
	notes: string;
}

export interface Paper {
	id: number;
	/** Null, it cannot be read now (the KMS not answering). */
	name: string | null;
	category: PaperCategory;
	notes: string | null;
	/** What its file is. */
	file: 'pdf' | 'image';
	/** Who wrote it down; null if their account is gone. */
	by: string | null;
	/** The agenda's events it belongs to (#399). */
	events: PaperEvent[];
}

/** An event of the agenda, as a paper says it belongs to it. */
export interface PaperEvent {
	id: number;
	title: string;
	/** Its first day. */
	day: string;
	repeats: boolean;
}

/** A paper as its event shows it: no more of it is read for the agenda. */
export type EventPaper = Pick<Paper, 'id' | 'name' | 'file'>;

export const MAX_PAPER_NAME = 120;
export const MAX_PAPER_NOTES = 5000;

/** What a page sends to be saved, only if well formed. */
export function parsePaperInput(body: unknown): PaperInput | null {
	if (!body || typeof body !== 'object') return null;
	const { name, category, notes } = body as Record<string, unknown>;
	if (typeof name !== 'string' || !name.trim() || !isPaperCategory(category)) return null;
	return {
		name: name.trim().slice(0, MAX_PAPER_NAME),
		category,
		notes: typeof notes === 'string' ? notes.trim().slice(0, MAX_PAPER_NOTES) : ''
	};
}
