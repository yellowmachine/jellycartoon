import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import { parseBillDetails } from 'comun/bills.ts';
import * as schema from '#lib/server/db/schema.ts';
import { bill, expense, expenseLine, family } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * What «Preguntar» reads of Dinero (#504) on a real Postgres (PGlite) as the app's role: the sums
 * by month and category, and the expenses found; only the family's.
 */
const db = drizzle(new PGlite(), { schema });
const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: 'ana',
	run: (fn) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
			return fn(tx);
		})
});
// As search.test.ts: what expenses.ts brings with it, without a database of its own nor AI.
mock.module('#lib/server/fridge.ts', () => ({
	houseKitchen: () => k,
	today: localDay,
	toBuy: async () => [],
	addItems: async () => []
}));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async () => ({}),
	VISION_MODEL: '',
	chatWithTools: async () => {
		throw new Error('Sin IA en esta prueba');
	},
	sayableError: (message: string) => message
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => null }));
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async () => {},
	removeFile: async () => {},
	readFile: async () => null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
// The voice's reads, tested where they are: here, only that they are called as the person.
const called: string[] = [];
mock.module('#lib/server/agenda/voice.ts', () => ({
	agendaByVoice: async (_k: Kitchen, args: { from: string }, kid: string | null) => {
		called.push(`agenda ${args.from} ${kid}`);
		return 'Lunes: dentista';
	}
}));
mock.module('#lib/server/memory.ts', () => ({
	describeMemories: async (_k: Kitchen, userId: string) => (called.push(`memories ${userId}`), '')
}));
mock.module('#lib/server/notes.ts', () => ({
	describeNotes: async (_k: Kitchen, userId: string, asked: { words: string | null }) => (
		called.push(`notes ${userId} ${asked.words}`),
		''
	)
}));
mock.module('#lib/server/rules.ts', () => ({
	listRules: async (_k: Kitchen, userId: string) => (
		called.push(`rules ${userId}`),
		[{ understood: 'Si falta leche, avisa', paused: true }]
	)
}));
mock.module('#lib/server/trips/voice.ts', () => ({
	plannedTripsByVoice: async () => (called.push('trips'), '')
}));
// Tested in periods.test.ts.
mock.module('#lib/server/periods.ts', () => ({
	PERIOD_DAYS: 31,
	findTrips: async (_k: Kitchen, userId: string, args: { place: string }) => (
		called.push(`find_trips ${userId} ${args.place}`),
		''
	),
	readPeriod: async (_k: Kitchen, userId: string, args: { from_day: string }) => (
		called.push(`read_period ${userId} ${args.from_day}`),
		''
	)
}));
// Tested in plugs/energy-read.test.ts.
mock.module('#lib/server/plugs/energy-read.ts', () => ({
	ENERGY_DAYS: 92,
	describePlugEnergy: async (_k: Kitchen, args: { plug: string }) => (
		called.push(`energy ${args.plug}`),
		''
	)
}));
// Tested in weather-read.test.ts.
mock.module('#lib/server/weather-read.ts', () => ({
	WEATHER_DAYS: 92,
	describeWeather: async (_k: Kitchen, args: { from_day: string }) => (
		called.push(`weather ${args.from_day}`),
		''
	)
}));
const reads = await import('./chat-reads.ts');
const { spendingBars } = await import('./blocks.ts');
const k = kitchen('A');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	const put = async (
		familyId: string,
		date: string,
		store: string,
		category: string,
		total: number,
		source: 'ticket' | 'factura' | 'mano' = 'mano'
	) => {
		const [row] = await db
			.insert(expense)
			.values({ familyId, date, store, category, total, source })
			.returning({ id: expense.id });
		return row!.id;
	};
	const mercadona = await put('A', '2026-09-05', 'Mercadona', 'Supermercado', 4520, 'ticket');
	await db.insert(expenseLine).values([
		{
			familyId: 'A',
			expenseId: mercadona,
			position: 0,
			text: 'Leche',
			amount: 120,
			tag: 'Lácteos'
		},
		{ familyId: 'A', expenseId: mercadona, position: 1, text: 'Pan', amount: 90, tag: 'Pan' }
	]);
	await put('A', '2026-09-20', 'Lidl', 'Supermercado', 1980);
	await put('A', '2026-10-02', 'Repsol', 'Gasolina', 6000);
	const light = await put('A', '2026-10-20', 'Iberdrola', 'Casa', 7345, 'factura');
	await db.insert(bill).values({
		familyId: 'A',
		expenseId: light,
		kind: 'Luz',
		periodStart: '2026-09-15',
		periodEnd: '2026-10-14',
		consumption: 312,
		unit: 'kWh',
		details: parseBillDetails({})
	});
	// Another family's: never seen.
	await put('B', '2026-10-03', 'Carrefour', 'Supermercado', 99900);
});

test('what was spent, month by month and by category, the biggest first; and the total', async () => {
	const said = await reads.describeSpending(k, '2026-09', '2026-10');
	expect(said.split('\n')).toEqual([
		'2026-09: 65,00 € (Supermercado 65,00 €)',
		'2026-10: 133,45 € (Casa 73,45 €, Gasolina 60,00 €)',
		'Total 2026-09 a 2026-10: 198,45 €. Meses sin línea: nada apuntado.'
	]);
	// The months either way round; one month alone.
	expect(await reads.describeSpending(k, '2026-10', '2026-09')).toBe(said);
	expect(await reads.describeSpending(k, '2026-10', '2026-10')).toStartWith('2026-10: 133,45 €');
});

test('nothing, too many months or no months: said so', async () => {
	expect(await reads.describeSpending(k, '2026-01', '2026-02')).toBe(
		'No hay gastos apuntados entre 2026-01 y 2026-02.'
	);
	expect(await reads.describeSpending(k, '2023-01', '2026-10')).toBe(
		'Como mucho 24 meses de una vez.'
	);
	expect(await reads.describeSpending(k, 'octubre', '2026-10')).toBe('Faltan los meses, AAAA-MM.');
});

test('expenses found by shop or what was bought, with the bill of a supply; only the family’s', async () => {
	expect(await reads.describeExpenses(k, { words: 'leche' })).toBe(
		'2026-09-05: Mercadona, 45,20 € (Supermercado): Leche, Pan'
	);
	expect(await reads.describeExpenses(k, { words: 'iberdrola' })).toBe(
		'2026-10-20: Iberdrola, 73,45 € (Casa, factura del 2026-09-15 al 2026-10-14, consumo 312 kWh)'
	);
	const october = await reads.describeExpenses(k, { from_day: '2026-10-01', to_day: '2026-10-31' });
	expect(october.split('\n').map((l) => l.slice(0, 10))).toEqual(['2026-10-20', '2026-10-02']);
	expect(await reads.describeExpenses(k, { words: 'carrefour' })).toBe('No hay ningún gasto así.');
});

test('the voice’s reads, as the person who asks: their notes, memories and rules', async () => {
	called.length = 0;
	expect(await reads.runRead(k, 'ana', 'read_agenda', { from: '2026-11-16' })).toBe(
		'Lunes: dentista'
	);
	await reads.runRead(k, 'ana', 'find_notes', { words: ' coche ' });
	await reads.runRead(k, 'ana', 'list_memories', {});
	expect(await reads.runRead(k, 'ana', 'list_rules', {})).toBe('Si falta leche, avisa (en pausa)');
	await reads.runRead(k, 'ana', 'planned_trips', {});
	await reads.runRead(k, 'ana', 'find_trips', { place: 'Alicante' });
	await reads.runRead(k, 'ana', 'read_period', { from_day: '2026-07-12', to_day: '2026-07-14' });
	await reads.runRead(k, 'ana', 'read_weather', { from_day: '2026-01-01' });
	await reads.runRead(k, 'ana', 'read_plug_energy', { plug: 'termo', from_day: '2026-01-01' });
	expect(called).toEqual([
		'agenda 2026-11-16 null',
		'notes ana coche',
		'memories ana',
		'rules ana',
		'trips',
		'find_trips ana Alicante',
		'read_period ana 2026-07-12',
		'weather 2026-01-01',
		'energy termo'
	]);
});

test('a read by its name; an unknown one, said so', async () => {
	expect(reads.isRead('read_spending')).toBe(true);
	expect(reads.isRead('propose_shopping')).toBe(false);
	expect(
		await reads.runRead(k, 'ana', 'read_spending', { from_month: '2026-09', to_month: '2026-09' })
	).toStartWith('2026-09: 65,00 €');
	expect(await reads.runRead(k, 'ana', 'borrar_todo', {})).toBe(
		'No hay ninguna herramienta «borrar_todo».'
	);
});

test('a chart of what was spent (#504): month by month, each category a series, empty months at nought', async () => {
	const block = await spendingBars(k, '2026-08', '2026-10', null);
	expect(block).toEqual({
		kind: 'barras',
		title: 'Gastos de 2026-08 a 2026-10',
		labels: ['2026-08', '2026-09', '2026-10'],
		series: [
			{ name: 'Casa', values: [0, 0, 7345] },
			{ name: 'Supermercado', values: [0, 6500, 0] },
			{ name: 'Gasolina', values: [0, 0, 6000] }
		]
	});
	expect(await spendingBars(k, '2026-10', '2026-10', ' Octubre ')).toMatchObject({
		title: 'Octubre',
		labels: ['2026-10']
	});
	expect(await spendingBars(k, '2026-01', '2026-02', null)).toBe(
		'No hay gastos apuntados entre 2026-01 y 2026-02: no hay gráfica.'
	);
	expect(await spendingBars(k, '2023-01', '2026-10', null)).toBe(
		'Como mucho 24 meses en una gráfica.'
	);
});

test('more categories than colours: the biggest keep theirs, the rest together in «Resto»', async () => {
	const many = kitchen('C');
	await db.insert(family).values({ id: 'C', name: 'Casa C' });
	const categories = [
		'Supermercado',
		'Restaurantes',
		'Gasolina',
		'Coche',
		'Casa',
		'Facturas',
		'Seguros',
		'Ropa',
		'Ocio'
	];
	await db.insert(expense).values(
		categories.map((category, i) => ({
			familyId: 'C',
			date: '2026-10-10',
			store: category,
			category,
			total: (10 - i) * 100,
			source: 'mano' as const
		}))
	);
	const block = await spendingBars(many, '2026-10', '2026-10', null);
	if (typeof block === 'string') throw new Error(block);
	expect(block.series.map((s) => s.name)).toEqual([...categories.slice(0, 6), 'Resto']);
	// Seguros, Ropa and Ocio: 400 + 300 + 200.
	expect(block.series.at(-1)!.values).toEqual([900]);
});
