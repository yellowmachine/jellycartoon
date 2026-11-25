import { daysBetween, dayName } from './agenda.ts';
import { euros } from './expenses.ts';

/**
 * Notices in the pages (#440), in yellow: by rules, without the AI, always right and free. On for
 * the family by default (Ajustes → Familia); each kind off with «No me lo vuelvas a decir».
 */

export const PAGE_NOTICE_KINDS = {
	repetido: 'Gastos y facturas repetidos',
	junta: 'Una factura o un pago que reúne varios gastos apuntados'
} as const;

export type PageNoticeKind = keyof typeof PAGE_NOTICE_KINDS;

export const isPageNoticeKind = (v: unknown): v is PageNoticeKind =>
	typeof v === 'string' && v in PAGE_NOTICE_KINDS;

/**
 * Why two expenses look the same: the same file; a bill of the same supply and period; or the same
 * day and total, one of them a receipt or a bill.
 */
export type SameBy = 'fichero' | 'periodo' | 'dia';

/** The expense another looks the same as. */
export interface LooksSame {
	id: number;
	date: string;
	store: string;
	total: number;
	by: SameBy;
}

/** The expenses another seems to gather: to leave them in one. */
export type MergeNotice = { id: number; date: string; total: number; text: string }[];

/** What an expense gathered (`id`, of that gathering). */
export interface MergedNotice {
	id: number;
	expenseId: number;
	parts: { date: string; total: number; text: string }[];
}

/** «Parece reunir 2 gastos que ya tienes: «Libro A», 18,11 €, y «Libro B», 17,89 € (36,00 €).» */
export function mergeText(parts: MergeNotice) {
	const each = parts.map((p) => `«${p.text}», ${euros(p.total)}`);
	if (each.length === 1) return `Parece ser de un gasto que ya tienes: ${each[0]}.`;
	const total = parts.reduce((s, p) => s + p.total, 0);
	return `Parece reunir ${parts.length} gastos que ya tienes: ${each.slice(0, -1).join(', ')} y ${each.at(-1)} (${euros(total)} en total).`;
}

const BY: Record<SameBy, string> = {
	fichero: 'el mismo archivo',
	periodo: 'la misma factura, del mismo periodo',
	dia: 'mismo día y mismo total'
};

/** «del martes», within the last week; else «del 3 de noviembre». */
function ofDay(day: string, today: string) {
	const ago = daysBetween(day, today);
	if (ago === 0) return 'de hoy';
	if (ago === 1) return 'de ayer';
	if (ago > 1 && ago < 7) return `del ${dayName(day).split(' ')[0]}`;
	return `del ${dayName(day, true).split(' ').slice(1).join(' ')}`;
}

/** «Esto parece igual al del martes: Mercadona, 23,45 € (mismo día y mismo total).» */
export const sameText = (l: LooksSame, today: string) =>
	`Esto parece igual al ${ofDay(l.date, today)}: ${l.store}, ${euros(l.total)} (${BY[l.by]}).`;
