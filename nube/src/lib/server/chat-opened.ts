import { and, eq } from 'drizzle-orm';
import { addDays, isDay, localDay, mondayOf } from 'comun/agenda.ts';
import { describeExpense } from '#lib/server/chat-reads.ts';
import { trip, walk } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { wishPersonName } from '#lib/server/wishes.ts';

/**
 * What the page beside Preguntar's panel has open (#504), so «esta», «aquí» or a bare question is
 * of it: a recipe of the book, a trip, a walk or an expense (its ticket) opened, the month of Dinero or the days of Agenda
 * it shows, or the wishes (#586). Read from its path and query, as the page itself reads them.
 */

export type Opened =
	| { kind: 'receta'; id: number }
	| { kind: 'trayecto'; id: number }
	| { kind: 'paseo'; id: number }
	| { kind: 'gasto'; id: number }
	| { kind: 'mes'; month: string; income: boolean }
	| { kind: 'dias'; from: string; to: string; month: boolean }
	| { kind: 'deseos'; person: string | null; shop: string | null };

const isMonth = (v: string | null): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const idOf = (v: string | null | undefined) => {
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
};

/** What `path` (with its query) has open; `today`, the family's day, for the pages without one. */
export function openedOf(path: string | null, today: string): Opened | null {
	if (!path) return null;
	let url: URL;
	try {
		url = new URL(path, 'http://x');
	} catch {
		return null;
	}
	const at = url.pathname.replace(/\/$/, '');
	const q = (name: string) => url.searchParams.get(name);

	const recipe = idOf(/^\/recetas\/(\d+)$/.exec(at)?.[1]);
	if (recipe) return { kind: 'receta', id: recipe };
	if (at === '/viajes/hechos') {
		const id = idOf(q('viaje'));
		return id ? { kind: 'trayecto', id } : null;
	}
	if (at === '/paseos') {
		const id = idOf(q('paseo'));
		return id ? { kind: 'paseo', id } : null;
	}
	const expense = at === '/gastos' ? idOf(q('gasto')) : null;
	if (expense) return { kind: 'gasto', id: expense };
	if (at === '/gastos' || at === '/gastos/ingresos') {
		const current = today.slice(0, 7);
		const asked = q('mes');
		const month = isMonth(asked) && asked <= current ? asked : current;
		return { kind: 'mes', month, income: at === '/gastos/ingresos' };
	}
	if (at === '/deseos') {
		const person = q('persona');
		return {
			kind: 'deseos',
			person: person && /^\d+$/.test(person) ? person : null,
			shop: q('tienda')?.slice(0, 100) || null
		};
	}
	if (at === '/agenda') {
		const asked = q('dia');
		const day = isDay(asked) ? asked : today;
		if (q('vista') === 'mes') {
			const first = `${day.slice(0, 8)}01`;
			const last = addDays(`${addDays(`${day.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1);
			return { kind: 'dias', from: first, to: last, month: true };
		}
		const monday = mondayOf(day);
		return { kind: 'dias', from: monday, to: addDays(monday, 6), month: false };
	}
	return null;
}

const MONTHS = [
	'enero',
	'febrero',
	'marzo',
	'abril',
	'mayo',
	'junio',
	'julio',
	'agosto',
	'septiembre',
	'octubre',
	'noviembre',
	'diciembre'
];
const monthName = (month: string) =>
	`${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
const km = (metres: number) =>
	`${(metres / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;

/** What is open, as the AI is told of it; null if it is not there (or not `userId`'s to see). */
export async function describeOpened(
	k: Kitchen,
	userId: string,
	opened: Opened | null,
	recipes: { id: number; title: string }[]
): Promise<string | null> {
	if (!opened) return null;
	switch (opened.kind) {
		case 'receta': {
			const recipe = recipes.find((r) => r.id === opened.id);
			return recipe
				? `la receta «${recipe.title}» [receta ${recipe.id}] (léela con «read_recipe»)`
				: null;
		}
		case 'trayecto': {
			const [drive] = await k.run((tx) =>
				tx
					.select()
					.from(trip)
					.where(and(eq(trip.id, opened.id), eq(trip.userId, userId)))
			);
			if (!drive) return null;
			const from = localDay(drive.startedAt);
			const to = localDay(drive.endedAt);
			return `su trayecto grabado del ${from}${to !== from ? ` al ${to}` : ''}${drive.destination ? `, hacia «${drive.destination}»` : ''}, de ${km(drive.distance)} (lo de esos días, con «read_period»)`;
		}
		case 'paseo': {
			const [one] = await k.run((tx) =>
				tx
					.select()
					.from(walk)
					.where(and(eq(walk.id, opened.id), eq(walk.userId, userId)))
			);
			if (!one) return null;
			return `su paseo del ${localDay(one.startedAt)}, de ${km(one.distance)} (lo de ese día, con «read_period»)`;
		}
		case 'gasto':
			return describeExpense(k, opened.id);
		case 'mes':
			return `${opened.income ? 'los ingresos' : 'los gastos'} de ${monthName(opened.month)} (${opened.month}): una pregunta sin mes es de ese`;
		case 'deseos': {
			const name = opened.person ? await wishPersonName(k, userId, opened.person) : null;
			const whose = name ? ` de ${name}` : '';
			const shop = opened.shop ? `, solo lo de ${opened.shop}` : '';
			return `la lista de deseos${whose}${shop}: una pregunta sin más es de esa (léela con «read_wishes»)`;
		}
		case 'dias':
			return opened.month
				? `la agenda del mes de ${monthName(opened.from.slice(0, 7))} (del ${opened.from} al ${opened.to}): una pregunta sin días es de esos`
				: `la agenda de la semana del ${opened.from} al ${opened.to}: una pregunta sin días es de esos`;
	}
}
