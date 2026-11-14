import { BILL_KINDS } from 'comun/bills.ts';

/**
 * The pages «Preguntar» may open beside it (#504 phase 3), already filtered: each one by what its
 * own page reads from its address, so what opens is the section as it is. Only these, built here:
 * the AI picks one and its filters, never writes an address.
 */

export const PAGES = {
	gastos_mes: 'Los gastos de un mes (Dinero → Gastos)',
	analisis: 'Dinero → Análisis: los últimos 12 meses, las categorías y las tiendas',
	busqueda: 'Dinero → Búsqueda: gastos por tienda o lo comprado, entre dos días',
	facturas: 'Dinero → Facturas de luz, agua o gas',
	ingresos_mes: 'Los ingresos de un mes (Dinero → Ingresos)',
	agenda: 'La agenda de una semana o de un mes',
	notas: 'Las notas de esta persona, buscadas por palabras',
	viajes: 'Viajes: los planeados y los hechos'
} as const;
export type PageName = keyof typeof PAGES;
export const isPageName = (v: unknown): v is PageName =>
	typeof v === 'string' && Object.hasOwn(PAGES, v);

export interface OpenPage {
	href: string;
	/** What the card says: «Dinero → Análisis, 12 meses». */
	label: string;
}

const isMonth = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const words = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');

function withQuery(path: string, query: Record<string, string | null>) {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
	const search = params.toString();
	return search ? `${path}?${search}` : path;
}

/** A page and its filters as the AI gave them: the address, or what is wrong, in words for it. */
export function openPage(name: unknown, args: Record<string, unknown>): OpenPage | string {
	if (!isPageName(name)) return `No hay ninguna página «${String(name)}».`;
	switch (name) {
		case 'gastos_mes':
			if (!isMonth(args.month)) return 'Falta el mes, AAAA-MM.';
			return { href: withQuery('/gastos', { mes: args.month }), label: `Dinero, ${args.month}` };
		case 'ingresos_mes':
			if (!isMonth(args.month)) return 'Falta el mes, AAAA-MM.';
			return {
				href: withQuery('/gastos/ingresos', { mes: args.month }),
				label: `Ingresos, ${args.month}`
			};
		case 'analisis': {
			const months = [3, 6, 12].includes(Number(args.months)) ? Number(args.months) : 6;
			const fixed = args.without_fixed === true;
			return {
				href: withQuery('/gastos/analisis', {
					meses: months === 6 ? null : String(months),
					fijos: fixed ? 'no' : null
				}),
				label: `Dinero → Análisis, ${months} meses${fixed ? ', sin fijos' : ''}`
			};
		}
		case 'busqueda': {
			const q = words(args.words);
			const from = isDay(args.from_day) ? args.from_day : null;
			const to = isDay(args.to_day) ? args.to_day : null;
			if (!q && !from && !to) return 'Falta qué buscar o entre qué días.';
			const when =
				from && to ? `del ${from} al ${to}` : from ? `desde ${from}` : to ? `hasta ${to}` : '';
			return {
				href: withQuery('/gastos/busqueda', { q, desde: from, hasta: to }),
				label: `Dinero → Búsqueda${q ? ` «${q}»` : ''}${when ? ` ${when}` : ''}`
			};
		}
		case 'facturas': {
			const kind = BILL_KINDS.find((k) => k === args.kind) ?? 'Luz';
			return {
				href: withQuery('/gastos/facturas', { de: kind }),
				label: `Facturas de ${kind.toLowerCase()}`
			};
		}
		case 'agenda': {
			const day = isDay(args.day) ? args.day : null;
			const month = args.month_view === true;
			return {
				href: withQuery('/agenda', { dia: day, vista: month ? 'mes' : null }),
				label: `Agenda, ${month ? 'el mes' : 'la semana'}${day ? ` del ${day}` : ''}`
			};
		}
		case 'notas': {
			const q = words(args.words);
			return { href: withQuery('/notas', { q }), label: q ? `Notas «${q}»` : 'Notas' };
		}
		case 'viajes':
			return { href: '/viajes', label: 'Viajes' };
	}
}
