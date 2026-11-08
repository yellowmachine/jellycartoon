import { daysBetween, dayName } from './agenda.ts';
import { euros } from './expenses.ts';

/**
 * Notices in the pages (#440), in yellow: by rules, without the AI, always right and free. On for
 * the family by default (Ajustes → Familia); each kind off with «No me lo vuelvas a decir».
 */

export const PAGE_NOTICE_KINDS = {
	repetido: 'Gastos y facturas repetidos'
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
