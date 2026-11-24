import { euros, isCategory } from 'comun/expenses.ts';
import { agendaByVoice } from '#lib/server/agenda/voice.ts';
import { expenseSums } from '#lib/server/expenses/analysis.ts';
import { searchExpenses } from '#lib/server/expenses/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { describeMemories } from '#lib/server/memory.ts';
import { describeNotes } from '#lib/server/notes.ts';
import type { Tool } from '#lib/server/openrouter.ts';
import { findTrips, PERIOD_DAYS, readPeriod } from '#lib/server/periods.ts';
import { listRules } from '#lib/server/rules.ts';
import { plannedTripsByVoice } from '#lib/server/trips/voice.ts';
import { describeWeather, WEATHER_DAYS } from '#lib/server/weather-read.ts';
import { describePlugEnergy, ENERGY_DAYS } from '#lib/server/plugs/energy-read.ts';
import { describeEnergyForecast } from '#lib/server/energy/forecast-read.ts';
import { describeAiSpending } from '#lib/server/expenses/ai-costs.ts';
import { describeWishes } from '#lib/server/wishes.ts';

/**
 * What «Preguntar» can read of the family's sections (#504, phase 2), to answer and to cross them:
 * the agenda, the money, the notes, what the voice remembers, the rules, the trips, and everything
 * of a few days (#505: periods.ts), and the weather (Open-Meteo, with degree-days: weather-read.ts) and what the plugs used (energy-read.ts), and Energía's forecast (forecast-read.ts), and what
 * the AI costs (ai-costs.ts). The same reads as the voice (command.ts) where it has them,
 * with what each person may see: their own notes and memories, the family's agenda and money. Only
 * reading: what is done, the chat proposes as cards.
 */

/** Months asked at once, at most: two years. */
const MAX_MONTHS = 24;
/** Expenses found, at most: the newest. */
const FOUND = 40;

const isMonth = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const fn = (
	name: string,
	description: string,
	properties: Record<string, unknown>,
	required: string[]
): Tool => ({
	type: 'function',
	function: {
		name,
		description,
		parameters: { type: 'object', properties, required, additionalProperties: false }
	}
});

export const READ_TOOLS: Tool[] = [
	fn(
		'read_agenda',
		'Lo apuntado en la agenda de la familia, día a día: «¿qué tenemos esta semana?», «¿cuándo es el dentista?».',
		{
			from: { type: 'string', description: 'El primer día, AAAA-MM-DD.' },
			to: {
				type: 'string',
				description: 'El último día, AAAA-MM-DD; como mucho, 31 días después.'
			}
		},
		['from']
	),
	fn(
		'read_spending',
		'Lo gastado por la familia (Dinero), sumado por mes y categoría, con los gastos fijos: «¿cuánto gastamos en súper este año?», «¿en qué se nos va el dinero?». Para gastos concretos, search_expenses.',
		{
			from_month: { type: 'string', description: 'El primer mes, AAAA-MM.' },
			to_month: {
				type: 'string',
				description: `El último mes, AAAA-MM; como mucho, ${MAX_MONTHS} meses en total.`
			}
		},
		['from_month', 'to_month']
	),
	fn(
		'search_expenses',
		`Gastos concretos de la familia (Dinero), los más recientes primero, hasta ${FOUND}: por la tienda o lo que se compró («¿cuándo compramos la freidora?», «¿cuánto pagamos de luz?»), entre dos días.`,
		{
			words: {
				type: 'string',
				description:
					'La tienda o lo comprado, una o dos palabras («Mercadona», «luz»). Vacío, todos los de esos días.'
			},
			from_day: { type: 'string', description: 'Desde qué día, AAAA-MM-DD.' },
			to_day: { type: 'string', description: 'Hasta qué día, AAAA-MM-DD.' }
		},
		[]
	),
	fn(
		'find_notes',
		'Las notas de esta persona (dictadas, escritas o grabadas en un paseo), las más recientes con su día, si pregunta por ellas.',
		{
			words: {
				type: 'string',
				description: 'Lo que debe poner, una o dos palabras. Vacío, todas.'
			},
			from_day: { type: 'string', description: 'Desde qué día, AAAA-MM-DD.' },
			until_day: { type: 'string', description: 'Hasta qué día, AAAA-MM-DD.' }
		},
		[]
	),
	fn(
		'list_memories',
		'Lo que esta persona y la familia han pedido a la voz que recuerde («mi talla de zapato», «la clave del wifi»).',
		{},
		[]
	),
	fn(
		'list_rules',
		'Las reglas de avisos de la familia y de esta persona («si alguien pone leche en la lista, avísame»).',
		{},
		[]
	),
	fn(
		'read_weather',
		`El tiempo de unos días, de Open-Meteo: cada día su mínima, máxima, media, lluvia y grados-día de calefacción y refrigeración; si son 3 días o menos, también cada 3 horas. Del pasado (desde 2022) o los próximos (hasta 16 días). Sin sitio, donde vive la familia. Para cruzarlo con el consumo, las facturas de luz o gas, los paseos o un viaje: «¿la factura de enero subió por el frío?», «¿qué tiempo hizo en Alicante?». Como mucho ${WEATHER_DAYS} días por llamada.`,
		{
			place: {
				type: 'string',
				description: 'Un pueblo o ciudad («Alicante»). Vacío, donde vive la familia.'
			},
			from_day: { type: 'string', description: 'El primer día, AAAA-MM-DD.' },
			to_day: { type: 'string', description: 'El último día, AAAA-MM-DD. Vacío, solo el primero.' }
		},
		['from_day']
	),
	fn(
		'read_plug_energy',
		`Lo que gastaron los enchufes de la familia (Energía → Enchufes), día a día: kWh y euros, de uno por su nombre o de todos, con el total y el reparto en punta, llano y valle. Con detail «horas», además por horas (hasta 7 días de un enchufe, hora a hora; más, la media de cada hora) y lo que gasta en reposo. Para «¿cuánto gasta el ordenador en suspensión?», «¿a qué horas gasta más?», «¿cuánto gastó el termo esta semana?» o, junto con read_weather, «¿el radiador gastó más los días fríos?». Como mucho ${ENERGY_DAYS} días por llamada.`,
		{
			plug: {
				type: 'string',
				description: 'El enchufe, por su nombre o parte («termo»). Vacío, todos.'
			},
			from_day: { type: 'string', description: 'El primer día, AAAA-MM-DD.' },
			to_day: { type: 'string', description: 'El último día, AAAA-MM-DD. Vacío, solo el primero.' },
			detail: {
				type: 'string',
				enum: ['dias', 'horas'],
				description: '«horas» para lo de las horas o el reposo. Vacío, solo por días.'
			}
		},
		['from_day']
	),
	fn(
		'read_energy_forecast',
		'Energía → Previsión de la familia, para los próximos 15 días: el frío (grados-día), la luz que se llevará (aprendida de los enchufes y de las facturas), el butano o el pellet (hasta cuándo llega lo que hay en casa, cuántos comprar) y las placas solares (lo que darán, lo que vendrá de la red, si la batería llega a la noche, las horas en que sobra sol). Para «¿cuánto saldrá la luz esta quincena?», «¿me llega el butano?», «¿cuándo pongo la lavadora?».',
		{},
		[]
	),
	fn(
		'planned_trips',
		'Los próximos viajes planeados de la familia, con el tiempo que hará.',
		{},
		[]
	),
	fn(
		'find_trips',
		'Los viajes de esta persona a un sitio o entre dos días, ya hechos o planeados: los trayectos grabados en el modo carretera (ida, vuelta y km), los viajes de Viajes y lo apuntado en la agenda. «Mis dos últimos viajes a Alicante», «¿cuándo fuimos a la playa?». Para saber sus días antes de read_period.',
		{
			place: {
				type: 'string',
				description: 'El sitio, una o dos palabras («Alicante»). Vacío, todos los viajes largos.'
			},
			from_day: {
				type: 'string',
				description: 'Desde qué día, AAAA-MM-DD. Vacío, dos años atrás.'
			},
			to_day: { type: 'string', description: 'Hasta qué día, AAAA-MM-DD. Vacío, hoy.' }
		},
		[]
	),
	fn(
		'read_period',
		`Todo lo de unos días, de todas las secciones: trayectos en coche, paseos y fotos de esta persona, gastos de la familia (por categoría y uno a uno), la agenda y sus notas. Para un viaje, unas vacaciones o «¿qué hicimos la semana pasada?». Como mucho ${PERIOD_DAYS} días.`,
		{
			from_day: { type: 'string', description: 'El primer día, AAAA-MM-DD.' },
			to_day: { type: 'string', description: 'El último día, AAAA-MM-DD.' }
		},
		['from_day', 'to_day']
	),
	fn(
		'read_ai_spending',
		'Lo que cuesta la inteligencia artificial de la familia (Dinero → IA), en dólares: esta semana, este mes y en total, por tipo (Voz, Preguntar, Tickets…) y por meses. Para «¿en qué se va la IA este mes?», «¿cuánto llevamos gastado en IA?». No son los gastos de la casa.',
		{},
		[]
	),
	fn(
		'read_wishes',
		'La lista de deseos de la familia (Deseos): lo que le gustaría a cada uno, de cualquier tienda, con su precio si se sabe, quién lo regala («Lo regalo yo») y si es para lo primero o para más adelante (sin decirlo, para pronto). Para «¿qué le regalo a mamá?», «¿qué hay de IKEA?», «¿cuánto suma la lista de Lucía?», «¿qué es lo primero que quiere Ana?». Lo que regalan a quien pregunta no sale: es una sorpresa, no lo adivines ni lo insinúes.',
		{
			person: {
				type: 'string',
				description: 'De quién, por su nombre. Vacío, de todos.'
			},
			shop: { type: 'string', description: 'De qué tienda («Amazon»). Vacío, de todas.' }
		},
		[]
	)
];

const READ_NAMES = new Set(READ_TOOLS.map((t) => t.function.name));
export const isRead = (name: string) => READ_NAMES.has(name);

/** What was spent, said in lines: each month's total and its categories, and the period's. */
export async function describeSpending(k: Kitchen, from: unknown, to: unknown) {
	if (!isMonth(from) || !isMonth(to)) return 'Faltan los meses, AAAA-MM.';
	const [first, last] = from <= to ? [from, to] : [to, from];
	const months =
		(Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
		Number(last.slice(5)) -
		Number(first.slice(5)) +
		1;
	if (months > MAX_MONTHS) return `Como mucho ${MAX_MONTHS} meses de una vez.`;
	const rows = await expenseSums(k, first, last);
	if (!rows.length) return `No hay gastos apuntados entre ${first} y ${last}.`;
	const byMonth = Map.groupBy(rows, (r) => r.month);
	const lines = [...byMonth].map(([month, cats]) => {
		const total = cats.reduce((s, c) => s + c.total, 0);
		const parts = cats
			.toSorted((a, b) => b.total - a.total)
			.map((c) => `${isCategory(c.category) ? c.category : 'Otros'} ${euros(c.total)}`);
		return `${month}: ${euros(total)} (${parts.join(', ')})`;
	});
	const all = rows.reduce((s, r) => s + r.total, 0);
	return [
		...lines,
		`Total ${first} a ${last}: ${euros(all)}. Meses sin línea: nada apuntado.`
	].join('\n');
}

/** Expenses found, a line each: day, shop, total, category and what it had. */
export async function describeExpenses(k: Kitchen, args: Record<string, unknown>) {
	const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
	const found = await searchExpenses(
		k,
		{ text: text(args.words) ?? '', from: day(args.from_day), to: day(args.to_day) },
		{ limit: FOUND }
	);
	if (!found.length) return 'No hay ningún gasto así.';
	return found
		.map((e) => {
			const lines = e.lines
				.slice(0, 5)
				.map((l) => l.text)
				.join(', ');
			const bill = e.bill
				? `, factura del ${e.bill.periodStart} al ${e.bill.periodEnd}${e.bill.consumption !== null ? `, consumo ${e.bill.consumption} ${e.bill.unit}` : ''}`
				: '';
			return `${e.date}: ${e.store}, ${euros(e.total)} (${e.category}${e.fixed ? ', fijo' : ''}${bill})${lines ? `: ${lines}` : ''}`;
		})
		.join('\n');
}

/**
 * One expense, all of it, as the AI is told of it when it is open beside Preguntar (chat-opened.ts):
 * its shop, day, total and every line, with its amount. Null if it is not the family's.
 */
export async function describeExpense(k: Kitchen, id: number) {
	const [e] = await searchExpenses(k, { text: '', from: null, to: null }, { ids: [id], limit: 1 });
	if (!e) return null;
	const bill = e.bill
		? `, factura del ${e.bill.periodStart} al ${e.bill.periodEnd}${e.bill.consumption !== null ? `, consumo ${e.bill.consumption} ${e.bill.unit}` : ''}`
		: '';
	const lines = e.lines
		.slice(0, 80)
		.map((l) => `- ${l.quantity ? `${l.quantity} × ` : ''}${l.text}: ${euros(l.amount)} (${l.tag})`)
		.join('\n');
	return `el gasto del ${e.date} en «${e.store}», ${euros(e.total)} (${e.category}${e.fixed ? ', fijo' : ''}${bill}), apuntado por ${e.by ?? 'alguien'}${lines ? `, con estas líneas del ticket:\n${lines}\n` : ', sin líneas'}`;
}

/** A read, done: what the AI is told. `userId`, whose notes, memories and rules. */
export async function runRead(
	k: Kitchen,
	userId: string,
	name: string,
	args: Record<string, unknown>
): Promise<string> {
	switch (name) {
		case 'read_agenda':
			return agendaByVoice(k, args, null);
		case 'read_spending':
			return describeSpending(k, args.from_month, args.to_month);
		case 'search_expenses':
			return describeExpenses(k, args);
		case 'find_notes':
			return describeNotes(k, userId, {
				words: text(args.words),
				fromDay: text(args.from_day),
				untilDay: text(args.until_day)
			});
		case 'list_memories':
			return describeMemories(k, userId);
		case 'list_rules': {
			const rules = await listRules(k, userId);
			return rules.length
				? rules.map((r) => `${r.understood}${r.paused ? ' (en pausa)' : ''}`).join('\n')
				: 'No hay ninguna regla todavía.';
		}
		case 'planned_trips':
			return plannedTripsByVoice(k);
		case 'find_trips':
			return findTrips(k, userId, args);
		case 'read_period':
			return readPeriod(k, userId, args);
		case 'read_weather':
			return describeWeather(k, args);
		case 'read_plug_energy':
			return describePlugEnergy(k, args);
		case 'read_energy_forecast':
			return describeEnergyForecast(k);
		case 'read_ai_spending':
			return describeAiSpending(k);
		case 'read_wishes':
			return describeWishes(k, userId, { person: text(args.person), shop: text(args.shop) });
		default:
			return `No hay ninguna herramienta «${name}».`;
	}
}
