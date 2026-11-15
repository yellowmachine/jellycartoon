import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import * as schema from '#lib/server/db/schema.ts';
import {
	expense,
	family,
	familyMember,
	recurringExpense,
	trip,
	tripPhoto,
	user,
	walk,
	walkPhoto
} from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import type { ReportPiece } from '#lib/reports.ts';

/**
 * Informes (#505, phase 3) on a real Postgres (PGlite) as the app's role: a trip's report made from
 * the AI's choice of blocks, each filled from the database with what its person sees; kept as it
 * was until «Actualizar», which keeps the words and the expenses taken away; only theirs.
 */
const db = drizzle(new PGlite(), { schema });
const kitchen = (familyId: string, userId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) =>
		db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
			return fn(tx);
		})
});
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
mock.module('#lib/server/agenda/agenda.ts', () => ({
	dayForVoice: async (_k: Kitchen, day: string) =>
		day === '2026-07-13' ? ['Cena con los primos a las 21:00'] : []
}));
mock.module('#lib/server/trips/planned.ts', () => ({ listPlannedTrips: async () => [] }));
// Tested in energy/energy-block.test.ts.
mock.module('#lib/server/energy/energy-block.ts', () => ({
	energyBlock: async () => 'La familia no tiene enchufes ni butano o pellet en Energía.'
}));
// Open-Meteo, asked where they were: the farthest the drives got.
const asked: string[] = [];
mock.module('comun/weather.ts', () => ({
	pastWeather: async (lat: number, lon: number, from: string, to: string) => {
		asked.push(`${lat} ${lon} ${from} ${to}`);
		return [
			{ day: '2026-07-12', code: 0, sky: 'despejado', min: 23, max: 31, rain: 0 },
			{ day: '2026-07-13', code: 61, sky: 'lluvia', min: 22, max: 27, rain: 4 }
		];
	}
}));
const reports = await import('./reports.ts');
const k = kitchen('A', 'ana');

const MURCIA: [number, number] = [-1.13, 37.99];
const ALICANTE: [number, number] = [-0.48, 38.35];
const at = (local: string) => new Date(local);
const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const point = (p: [number, number], t: string): [number, number, number] => [
	p[0],
	p[1],
	at(t).getTime() / 1000
];
let dinner = 0;
let online = 0;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'pedro'].map(person));
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pedro', familyId: 'A', role: 'member' }
	]);
	const drive = (
		userId: string,
		start: string,
		end: string,
		km: number,
		a: [number, number],
		b: [number, number],
		destination: string | null = null
	) => ({
		familyId: 'A',
		userId,
		startedAt: at(start),
		endedAt: at(end),
		distance: km * 1000,
		destination,
		line: [point(a, start), point(b, end)]
	});
	await db
		.insert(trip)
		.values([
			drive('ana', '2026-07-12T10:00:00', '2026-07-12T11:00:00', 80, MURCIA, ALICANTE, 'Alicante'),
			drive('ana', '2026-07-14T18:00:00', '2026-07-14T19:00:00', 80, ALICANTE, MURCIA),
			drive('pedro', '2026-07-13T10:00:00', '2026-07-13T11:00:00', 300, MURCIA, [-3.7, 40.42])
		]);
	const [w] = await db
		.insert(walk)
		.values({
			familyId: 'A',
			userId: 'ana',
			startedAt: at('2026-07-13T08:00:00'),
			endedAt: at('2026-07-13T09:00:00'),
			distance: 4200,
			line: [point(ALICANTE, '2026-07-13T08:00:00'), point([-0.47, 38.34], '2026-07-13T09:00:00')],
			diagnosis: { fixes: 0, hiddenFixes: 0, musicFixes: 0, hiddenSeconds: 0, gaps: [] }
		})
		.returning({ id: walk.id });
	await db.insert(walkPhoto).values({
		familyId: 'A',
		userId: 'ana',
		walkId: w!.id,
		clientId: 'a',
		file: 'a.jpg',
		at: at('2026-07-13T08:30:00')
	});
	await db.insert(tripPhoto).values([
		{
			familyId: 'A',
			userId: 'ana',
			takenAt: at('2026-07-12T11:05:00'),
			lon: ALICANTE[0],
			lat: ALICANTE[1]
		},
		{ familyId: 'A', userId: 'pedro', takenAt: at('2026-07-13T12:00:00') }
	]);
	const put = async (
		date: string,
		store: string,
		category: string,
		total: number,
		recurringId: number | null = null
	) => {
		const [row] = await db
			.insert(expense)
			.values({ familyId: 'A', date, store, category, total, source: 'mano', recurringId })
			.returning({ id: expense.id });
		return row!.id;
	};
	dinner = await put('2026-07-13', 'Restaurante del Puerto', 'Restaurantes', 6400);
	await put('2026-07-12', 'Repsol', 'Gasolina', 5000);
	online = await put('2026-07-13', 'Amazon', 'Compras', 2500);
	const [rent] = await db
		.insert(recurringExpense)
		.values({ familyId: 'A', name: 'Alquiler', category: 'Casa', amount: 80000, day: 14 })
		.returning({ id: recurringExpense.id });
	await put('2026-07-14', 'Alquiler', 'Casa', 80000, rent!.id);
});

const TRIP = {
	title: ' Alicante, julio ',
	from_day: '2026-07-14',
	to_day: '2026-07-12',
	pieces: [
		{ text: 'Tres días en Alicante.', block: 'cifras' },
		{ text: '', block: 'mapa' },
		{ text: 'Hizo calor, con un día de lluvia.', block: 'tiempo' },
		{ text: '', block: 'fotos' },
		{ text: 'Los gastos.', block: 'gastos' },
		{ text: '', block: 'agenda' },
		{ text: 'Nada más.', block: '' },
		{ text: '', block: 'inventado' }
	]
};
const blockOf = <K extends string>(pieces: ReportPiece[], kind: K) =>
	pieces.find((p) => p.kind === kind)?.block as Extract<ReportPiece['block'], { kind: K }>;

test("a trip's report: each block from the database, what its person sees", async () => {
	const made = await reports.makeReport(k, 'ana', TRIP);
	if (typeof made === 'string') throw new Error(made);
	expect(made).toMatchObject({ title: 'Alicante, julio', from: '2026-07-12', to: '2026-07-14' });
	// Words without a block stay; a block that is not one, only its words (none here: left out).
	expect(made.pieces.map((p) => p.kind)).toEqual([
		'cifras',
		'mapa',
		'tiempo',
		'fotos',
		'gastos',
		'agenda',
		null
	]);
	expect(blockOf(made.pieces, 'cifras')).toEqual({
		kind: 'cifras',
		days: 3,
		driven: 160_000,
		drives: 2,
		walked: 4200,
		walks: 1,
		photos: 2,
		expenses: expect.arrayContaining([
			{ id: dinner, total: 6400 },
			{ id: online, total: 2500 }
		])
	});
	expect(blockOf(made.pieces, 'cifras').expenses).toHaveLength(3);
	expect(blockOf(made.pieces, 'mapa').ways).toHaveLength(3);
	expect(blockOf(made.pieces, 'mapa').photos).toHaveLength(1);
	// Each drive and walk of hers, in order, to open in Viajes or Paseos; not Pedro's.
	expect(
		blockOf(made.pieces, 'mapa').moves?.map((m) => [m.from, m.distance, m.destination])
	).toEqual([
		['viaje', 80_000, 'Alicante'],
		['paseo', 4200, null],
		['viaje', 80_000, null]
	]);
	expect(blockOf(made.pieces, 'fotos').photos.map((p) => p.from)).toEqual(['viaje', 'paseo']);
	// Not the rent: a fixed one is not of the trip.
	expect(blockOf(made.pieces, 'gastos').items.map((e) => e.store)).toEqual([
		'Repsol',
		'Restaurante del Puerto',
		'Amazon'
	]);
	expect(blockOf(made.pieces, 'agenda').days).toEqual([
		{ day: '2026-07-13', events: ['Cena con los primos a las 21:00'] }
	]);
	expect(blockOf(made.pieces, 'tiempo')).toMatchObject({ kind: 'tiempo', place: 'Alicante' });
	expect(asked).toEqual([`${ALICANTE[1]} ${ALICANTE[0]} 2026-07-12 2026-07-14`]);
	expect(reports.describePiece(made.pieces[0]!)).toBe(
		'[cifras: 3 días, 160 km en 2 trayectos, 1 paseos (4 km), 2 fotos, 139,00 € gastados]'
	);
});

test('kept as it was; «Actualizar» takes the figures again, the words and the expenses taken away stay', async () => {
	const made = await reports.makeReport(k, 'ana', TRIP);
	if (typeof made === 'string') throw new Error(made);
	expect(await reports.setExcluded(k, 'ana', made.id, online, true)).toBe(true);
	// A dinner put in later: not in the report until it is brought up to date.
	await db.insert(expense).values({
		familyId: 'A',
		date: '2026-07-14',
		store: 'Heladería',
		category: 'Restaurantes',
		total: 800,
		source: 'mano'
	});
	const still = await reports.getReport(k, 'ana', made.id);
	expect(blockOf(still!.pieces, 'gastos').items).toHaveLength(3);
	expect(still!.excluded).toEqual([online]);
	expect(reports.describePiece(still!.pieces[4]!, still!.excluded)).toBe(
		'[gastos: 2, Restaurantes 64,00 €, Gasolina 50,00 €]'
	);

	expect(await reports.refreshReport(k, 'ana', made.id)).toBe(true);
	const fresh = await reports.getReport(k, 'ana', made.id);
	expect(blockOf(fresh!.pieces, 'gastos').items).toHaveLength(4);
	expect(fresh!.excluded).toEqual([online]);
	expect(fresh!.pieces[0]!.text).toBe('Tres días en Alicante.');
	expect(fresh!.refreshedAt.getTime()).toBeGreaterThanOrEqual(fresh!.createdAt.getTime());

	expect(await reports.setExcluded(k, 'ana', made.id, online, false)).toBe(true);
	expect((await reports.getReport(k, 'ana', made.id))!.excluded).toEqual([]);
});

test('only its person sees, changes or deletes it', async () => {
	const made = await reports.makeReport(k, 'ana', TRIP);
	if (typeof made === 'string') throw new Error(made);
	const pedro = kitchen('A', 'pedro');
	expect(await reports.getReport(pedro, 'pedro', made.id)).toBeNull();
	expect(await reports.listReports(pedro, 'pedro')).toEqual([]);
	expect(await reports.refreshReport(pedro, 'pedro', made.id)).toBe(false);
	expect(await reports.renameReport(pedro, 'pedro', made.id, 'Mío')).toBe(false);
	await reports.deleteReport(pedro, 'pedro', made.id);
	expect(await reports.getReport(k, 'ana', made.id)).not.toBeNull();

	expect(await reports.renameReport(k, 'ana', made.id, '  Playa  ')).toBe(true);
	expect((await reports.listReports(k, 'ana'))[0]).toMatchObject({ id: made.id, title: 'Playa' });
	await reports.deleteReport(k, 'ana', made.id);
	expect(await reports.getReport(k, 'ana', made.id)).toBeNull();
});

test('what the AI asks wrong is told, nothing kept', async () => {
	const count = (await reports.listReports(k, 'ana')).length;
	expect(await reports.makeReport(k, 'ana', { ...TRIP, title: ' ' })).toBe('Falta el título.');
	expect(await reports.makeReport(k, 'ana', { ...TRIP, to_day: 'ayer' })).toBe(
		'Faltan los días, AAAA-MM-DD.'
	);
	expect(await reports.makeReport(k, 'ana', { ...TRIP, from_day: '2026-01-01' })).toBe(
		'Como mucho 31 días en un informe.'
	);
	expect(
		await reports.makeReport(k, 'ana', { ...TRIP, pieces: [{ text: 'Solo texto', block: '' }] })
	).toStartWith('Un informe lleva al menos un bloque');
	expect(await reports.listReports(k, 'ana')).toHaveLength(count);
});

test('a block with nothing to show says why; the weather without knowing where, too', async () => {
	const made = await reports.makeReport(k, 'ana', {
		title: 'Agosto',
		from_day: '2026-08-01',
		to_day: '2026-08-03',
		pieces: [
			{ text: '', block: 'mapa' },
			{ text: '', block: 'tiempo' },
			{ text: '', block: 'gastos' }
		]
	});
	if (typeof made === 'string') throw new Error(made);
	expect(made.pieces.map((p) => [p.block, p.empty])).toEqual([
		[null, 'No hay trayectos ni paseos grabados esos días.'],
		[null, 'No sé dónde se estuvo esos días: sin trayectos grabados ni viaje planeado.'],
		[null, 'No hay gastos apuntados esos días.']
	]);
});

test('a way thinned keeps its ends', () => {
	const line = Array.from({ length: 1000 }, (_, i): [number, number, number] => [i, i, i]);
	const kept = reports.thin(line, 100);
	expect(kept.length).toBeLessThanOrEqual(101);
	expect(kept[0]).toEqual([0, 0]);
	expect(kept.at(-1)).toEqual([999, 999]);
});
