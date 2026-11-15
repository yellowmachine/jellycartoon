import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import * as schema from '#lib/server/db/schema.ts';
import {
	calendarEvent,
	expense,
	expenseLine,
	family,
	familyMember,
	recurringExpense,
	savedPlace,
	trip,
	tripPhoto,
	user,
	walk,
	walkPhoto
} from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * Periods and places (#505, phase 1) on a real Postgres (PGlite) as the app's role: the trips of
 * whoever asks, found by their place (driven, planned, in the agenda) and joined when they are the
 * same days; and everything of a few days, only what that person sees.
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
// Tested where they are: here, only that they are read for those days and that person.
const called: string[] = [];
mock.module('#lib/server/agenda/voice.ts', () => ({
	agendaByVoice: async (_k: Kitchen, args: { from: string; to: string }) => (
		called.push(`agenda ${args.from} ${args.to}`),
		'domingo 12: Vacaciones en Alicante'
	)
}));
mock.module('#lib/server/notes.ts', () => ({
	describeNotes: async (_k: Kitchen, userId: string, asked: { fromDay: string }) => (
		called.push(`notes ${userId} ${asked.fromDay}`),
		'2026-07-13: el restaurante del puerto, muy bueno'
	)
}));
mock.module('#lib/server/trips/planned.ts', () => ({
	listPlannedTrips: async () => [
		{
			id: 1,
			name: 'Playa octubre',
			private: false,
			mine: true,
			people: [],
			legs: [
				{ id: 1, day: '2026-10-03', time: '09:00', from: 'Casa', to: 'Alicante' },
				{ id: 2, day: '2026-10-05', time: '18:00', from: 'Alicante', to: 'Casa' }
			]
		},
		{ id: 2, name: 'Sin tramos', private: false, mine: true, people: [], legs: [] }
	]
}));
const { findTrips, readPeriod, staysOf } = await import('./periods.ts');
const k = kitchen('A', 'ana');

const MURCIA: [number, number] = [-1.13, 37.99];
const ALICANTE: [number, number] = [-0.48, 38.35];
const MADRID: [number, number] = [-3.7, 40.42];
const at = (local: string) => new Date(local);
const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'pedro', 'berta'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pedro', familyId: 'A', role: 'member' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
	const drive = (
		userId: string,
		start: string,
		end: string,
		km: number,
		to: [number, number],
		destination: string | null = null,
		familyId = 'A'
	) => ({
		familyId,
		userId,
		startedAt: at(start),
		endedAt: at(end),
		distance: km * 1000,
		destination,
		line: [[...to, at(end).getTime() / 1000] as [number, number, number]]
	});
	await db.insert(trip).values([
		// July: there with the route set, around the town, and back.
		drive(
			'ana',
			'2026-07-12T10:00:00',
			'2026-07-12T11:00:00',
			80,
			ALICANTE,
			'Playa del Postiguet, Alicante'
		),
		drive('ana', '2026-07-13T12:00:00', '2026-07-13T12:20:00', 5, [-0.5, 38.36]),
		drive('ana', '2026-07-14T18:00:00', '2026-07-14T19:00:00', 80, MURCIA),
		// October: no route, but it ends at a place kept with its name.
		drive('ana', '2026-10-03T09:00:00', '2026-10-03T10:00:00', 80, [-0.481, 38.351]),
		drive('ana', '2026-10-05T18:00:00', '2026-10-05T19:00:00', 80, MURCIA),
		// Gone, not back yet.
		drive('ana', '2026-11-01T08:00:00', '2026-11-01T12:00:00', 400, MADRID, 'Madrid'),
		// Someone else's: never hers.
		drive('pedro', '2026-08-01T10:00:00', '2026-08-01T11:00:00', 80, ALICANTE, 'Alicante centro'),
		drive('berta', '2026-09-01T10:00:00', '2026-09-01T11:00:00', 80, ALICANTE, 'Alicante', 'B')
	]);
	await db.insert(savedPlace).values([
		{ familyId: 'A', userId: 'ana', name: 'Piso Alicante', lon: -0.48, lat: 38.35 },
		{ familyId: 'A', userId: 'ana', name: 'Casa', lon: MURCIA[0], lat: MURCIA[1] }
	]);
	await db.insert(calendarEvent).values([
		{
			familyId: 'A',
			title: 'Vacaciones en Alicante',
			startDay: '2026-07-12',
			endDay: '2026-07-14'
		},
		{ familyId: 'A', title: 'Dentista', startDay: '2026-07-13' }
	]);
	const [w] = await db
		.insert(walk)
		.values({
			familyId: 'A',
			userId: 'ana',
			startedAt: at('2026-07-13T08:00:00'),
			endedAt: at('2026-07-13T09:00:00'),
			distance: 4200,
			diagnosis: { fixes: 0, hiddenFixes: 0, musicFixes: 0, hiddenSeconds: 0, gaps: [] }
		})
		.returning({ id: walk.id });
	await db.insert(walkPhoto).values([
		{
			familyId: 'A',
			userId: 'ana',
			walkId: w!.id,
			clientId: 'a',
			file: 'a.jpg',
			at: at('2026-07-13T08:30:00')
		}
	]);
	await db.insert(tripPhoto).values([
		{ familyId: 'A', userId: 'ana', takenAt: at('2026-07-12T11:05:00') },
		{ familyId: 'A', userId: 'ana', takenAt: at('2026-07-14T12:00:00') },
		{ familyId: 'A', userId: 'pedro', takenAt: at('2026-07-13T12:00:00') }
	]);
	const put = async (
		familyId: string,
		date: string,
		store: string,
		category: string,
		total: number,
		recurringId: number | null = null
	) => {
		const [row] = await db
			.insert(expense)
			.values({ familyId, date, store, category, total, source: 'mano', recurringId })
			.returning({ id: expense.id });
		return row!.id;
	};
	const dinner = await put('A', '2026-07-13', 'Restaurante del Puerto', 'Restaurantes', 6400);
	await db
		.insert(expenseLine)
		.values([
			{ familyId: 'A', expenseId: dinner, position: 0, text: 'Arroz a banda', amount: 3200 }
		]);
	await put('A', '2026-07-12', 'Repsol', 'Gasolina', 5000);
	const [rent] = await db
		.insert(recurringExpense)
		.values({ familyId: 'A', name: 'Alquiler', category: 'Casa', amount: 80000, day: 14 })
		.returning({ id: recurringExpense.id });
	await put('A', '2026-07-14', 'Alquiler', 'Casa', 80000, rent!.id);
	await put('A', '2026-07-20', 'Mercadona', 'Supermercado', 4000);
	await put('B', '2026-07-13', 'Carrefour', 'Supermercado', 99900);
});

test('the trips to a place: driven, planned and in the agenda, joined when the same days', async () => {
	const said = await findTrips(k, 'ana', { place: 'alicante' }, at('2026-11-15T12:00:00'));
	const lines = said.split('\n').filter((l) => l.startsWith('- '));
	expect(lines).toHaveLength(2);
	expect(lines[0]).toStartWith('- 2026-07-12 a 2026-07-14: Playa del Postiguet, Alicante:');
	expect(lines[0]).toContain('ida el 12/7/2026 (80 km), vuelta el 14/7/2026 (80 km)');
	expect(lines[0]).toContain('165 km en 3 trayectos');
	expect(lines[0]).toContain('en la agenda: «Vacaciones en Alicante»');
	expect(lines[1]).toStartWith('- 2026-10-03 a 2026-10-05: Piso Alicante / Alicante:');
	expect(lines[1]).toContain('planeado en Viajes, «Playa octubre»');
	// Not Pedro's, not another family's, not the dentist.
	expect(said).not.toContain('2026-08-01');
	expect(said).not.toContain('2026-09-01');
	expect(said).not.toContain('Dentista');
	expect(said).toContain('pregunta si son estos');
});

test('without a place, the long drives and the planned trips; a stay not driven back says so', async () => {
	const said = await findTrips(k, 'ana', {}, at('2026-11-15T12:00:00'));
	const lines = said.split('\n').filter((l) => l.startsWith('- '));
	expect(lines.map((l) => l.slice(2, 26))).toEqual([
		'2026-07-12 a 2026-07-14:',
		'2026-10-03 a 2026-10-05:',
		'2026-11-01: Madrid: grab'
	]);
	expect(lines[2]).toContain('sin vuelta grabada');
});

test('between two days, and nothing found said as such', async () => {
	const october = await findTrips(k, 'ana', {
		place: 'Alicante',
		from_day: '2026-09-01',
		to_day: '2026-10-31'
	});
	expect(october.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1);
	expect(await findTrips(k, 'ana', { place: 'Benidorm' })).toContain(
		'No hay ningún viaje a «Benidorm»'
	);
	expect(await findTrips(k, 'ana', { from_day: '2026-12-01', to_day: '2026-11-01' })).toContain(
		'va antes'
	);
});

test('a stay ends a month after, and the next drive can start another', () => {
	const d = (day: string, to: [number, number], destination: string | null = null) => ({
		startedAt: at(`${day}T10:00:00`),
		endedAt: at(`${day}T11:00:00`),
		distance: 80_000,
		destination,
		end: to
	});
	const stays = staysOf(
		[
			d('2026-01-01', ALICANTE, 'Alicante'),
			d('2026-03-01', ALICANTE, 'Alicante'),
			d('2026-03-03', MURCIA)
		],
		(x) => x.destination
	);
	expect(stays.map((s) => [s.from, s.to])).toEqual([
		['2026-01-01', null],
		['2026-03-01', '2026-03-03']
	]);
});

test('everything of a few days, only what that person sees', async () => {
	called.length = 0;
	const said = await readPeriod(k, 'ana', { from_day: '2026-07-14', to_day: '2026-07-12' });
	expect(said).toStartWith('Del 2026-07-12 al 2026-07-14:');
	expect(said).toContain('En coche (grabado): 3 trayectos, 165 km.');
	expect(said).toContain('a Playa del Postiguet, Alicante');
	expect(said).toContain('Paseos: 1, 4 km. 2026-07-13 4 km.');
	// Hers: two from the road, one from the walk; not Pedro's.
	expect(said).toContain(
		'Fotos (del modo carretera y de los paseos): 3. 2026-07-12 1; 2026-07-13 1; 2026-07-14 1.'
	);
	expect(said).toContain(
		'Gastos de la familia esos días: 2, 114,00 € (Restaurantes 64,00 €, Gasolina 50,00 €)'
	);
	expect(said).toContain('no guardan dónde se hicieron');
	expect(said).toContain(
		'2026-07-13: Restaurante del Puerto, 64,00 € (Restaurantes): Arroz a banda'
	);
	expect(said).toContain('Fijos que cayeron esos días (no son del viaje): Alquiler 800,00 €.');
	expect(said).not.toContain('Mercadona');
	expect(said).not.toContain('Carrefour');
	expect(said).toContain('Vacaciones en Alicante');
	expect(said).toContain('el restaurante del puerto');
	expect(called).toEqual(['agenda 2026-07-12 2026-07-14', 'notes ana 2026-07-12']);
});

test('a period too long or without its days is refused', async () => {
	expect(await readPeriod(k, 'ana', { from_day: '2026-07-01', to_day: '2026-08-15' })).toContain(
		'Como mucho 31 días'
	);
	expect(await readPeriod(k, 'ana', { from_day: '2026-07-01' })).toContain('Faltan los días');
});
