import { afterAll, beforeAll, expect, mock, setSystemTime, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import {
	expense,
	family,
	inbox,
	familyMember,
	familyPerson,
	kidGuardian,
	medication,
	medicationDose,
	plug,
	plugEnergy,
	trip,
	user,
	wish
} from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Resumen, phase 3 (#624), on a real Postgres (PGlite) as the app's role: each block reads only
 * what the one looking may see. Their car and medication, not another adult's; the wishes, never
 * the gifts for them.
 */
// A Wednesday at noon: the last 7 days are the 19th to the 25th.
const NOW = new Date(2026, 10, 25, 12, 0);
setSystemTime(NOW);
afterAll(() => void setSystemTime());

const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
// What summary.ts brings and does not use here (Bun's mocks are the whole run's: as search.test.ts's).
mock.module('#lib/server/db/index.ts', () => ({ db }));
mock.module('#lib/server/push.ts', () => ({ notify: async () => {} }));
mock.module('#lib/server/inbox.ts', () => ({ tell: async () => {} }));
mock.module('#lib/server/telegram/bot.ts', () => ({ tellGroup: async () => {} }));
mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async () => {},
	removeFile: async () => {},
	readFile: async () => null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));
mock.module('#lib/server/openrouter.ts', () => ({
	completeJson: async () => ({}),
	VISION_MODEL: '',
	chatWithTools: async () => {
		throw new Error('Sin IA en esta prueba');
	},
	sayableError: (message: string) => message
}));
mock.module('#lib/server/family-secret.ts', () => ({
	kmsOn: false,
	scaleway: async () => {
		throw new Error('Sin KMS en esta prueba');
	},
	checkKms: async () => null,
	sealFor: async (_: string, text: string) => text,
	openFor: async (_: string, value: string) => value,
	sealFileFor: async (_: string, bytes: Uint8Array) => bytes,
	openFileFor: async (_: string, sealed: Uint8Array) => sealed,
	sealedNow: () => true
}));

const { summaryOf, summaryOff } = await import('./summary.ts');
const { getReport, keepSummary, refreshReport } = await import('./reports.ts');
const { overToday, sendSummaryNotices } = await import('./summary-notice.ts');

const kitchen = (userId: string): Kitchen => ({
	familyId: 'A',
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const account = (id: string) => ({
	id,
	name: { ana: 'Ana', pepe: 'Pepe', lucia: 'Lucía' }[id] ?? id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour);
const people: Record<string, number> = {};

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	await db.insert(user).values(['ana', 'pepe', 'lucia'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pepe', familyId: 'A', role: 'member' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' }
	]);
	await db.insert(kidGuardian).values({ familyId: 'A', kidId: 'lucia', guardianId: 'ana' });
	const rows = await db
		.insert(familyPerson)
		.values([
			{ familyId: 'A', userId: 'ana', name: 'Ana' },
			{ familyId: 'A', userId: 'pepe', name: 'Pepe' },
			{ familyId: 'A', userId: 'lucia', name: 'Lucía' }
		])
		.returning();
	for (const r of rows) people[r.name] = r.id;

	await db.insert(trip).values([
		{ familyId: 'A', userId: 'ana', startedAt: at(20), endedAt: at(20, 11), distance: 80_000 },
		{ familyId: 'A', userId: 'ana', startedAt: at(23), endedAt: at(23, 11), distance: 120_000 },
		// The 7 before, as far in: the 12th at 10 is; the 18th at 13, not.
		{ familyId: 'A', userId: 'ana', startedAt: at(12), endedAt: at(12, 11), distance: 50_000 },
		{ familyId: 'A', userId: 'ana', startedAt: at(18, 13), endedAt: at(18, 14), distance: 1 },
		// Another adult's.
		{ familyId: 'A', userId: 'pepe', startedAt: at(21), endedAt: at(21, 11), distance: 999_000 }
	]);
	await db.insert(expense).values([
		{
			familyId: 'A',
			date: '2026-11-21',
			store: 'Repsol',
			category: 'Gasolina',
			total: 6000,
			source: 'mano',
			userId: 'ana'
		},
		{
			familyId: 'A',
			date: '2026-11-22',
			store: 'Cepsa',
			category: 'Gasolina',
			total: 5000,
			source: 'mano',
			userId: 'pepe'
		}
	]);

	// Lucía's, a child of Ana's; Pepe's, not told to Ana.
	const [lucia, pepe] = await db
		.insert(medication)
		.values([
			{
				familyId: 'A',
				personId: people['Lucía']!,
				name: 'Dalsy',
				times: ['09:00'],
				startDay: '2026-11-24'
			},
			{
				familyId: 'A',
				personId: people['Pepe']!,
				name: 'Sintrom',
				times: ['09:00'],
				startDay: '2026-11-01'
			}
		])
		.returning();
	await db.insert(medicationDose).values({
		familyId: 'A',
		medicationId: lucia!.id,
		day: '2026-11-24',
		time: '09:00',
		takenAt: at(24, 9)
	});
	void pepe;

	await db
		.insert(plug)
		.values({ id: 'p1', familyId: 'A', name: 'Lavadora', kind: 'lavadora', hash: 'h1' });
	await db.insert(plugEnergy).values([
		{ plugId: 'p1', familyId: 'A', hour: at(20), wh: 1500 },
		{ plugId: 'p1', familyId: 'A', hour: at(21), wh: 0, mark: 'sin_dato' }
	]);

	const wishOf = (personId: number, title: string, boughtBy: string) => ({
		familyId: 'A',
		personId,
		url: `https://tienda.es/${title}`,
		shop: 'Tienda',
		title,
		priceCents: 2500,
		currency: 'EUR',
		boughtOn: '2026-11-22',
		boughtBy,
		giftBy: boughtBy
	});
	await db.insert(wish).values([
		// Ana's gift for Pepe: Ana sees it.
		wishOf(people['Pepe']!, 'Libro', 'ana'),
		// Pepe's for Ana, in secret: Ana never.
		wishOf(people['Ana']!, 'Sorpresa', 'pepe')
	]);
});

test('each block, only what the one looking may see', async () => {
	const s = await summaryOf(kitchen('ana'), 'ana', 'dias', null, '2026-11-25', [], NOW);
	expect(s.car).toEqual({
		metres: 200_000,
		trips: 2,
		before: 50_000,
		fuel: 6000,
		fuels: 1
	});
	expect(s.medication).toEqual([
		{
			personId: String(people['Lucía']),
			name: 'Lucía',
			taken: 1,
			due: 2,
			missed: [{ day: '2026-11-25', time: '09:00', name: 'Dalsy' }],
			more: 0
		}
	]);
	expect(s.energy).toMatchObject({ wh: 1500, cents: null, noData: 1, before: null });
	expect(s.wishes).toMatchObject({ count: 1, total: 2500, unknown: 0 });
	expect(s.wishes!.items.map((w) => w.title)).toEqual(['Libro']);

	// Pepe: his own trips and fuel, his own medication; Ana's gift for him, hidden.
	const p = await summaryOf(kitchen('pepe'), 'pepe', 'dias', null, '2026-11-25', [], NOW);
	expect(p.car).toMatchObject({ metres: 999_000, fuel: 5000 });
	expect(p.medication.map((m) => m.name)).toEqual(['Pepe']);
	expect(p.wishes!.items.map((w) => w.title)).toEqual(['Sorpresa']);

	// Taken out in Ajustes: not read.
	const off = await summaryOf(
		kitchen('ana'),
		'ana',
		'dias',
		null,
		'2026-11-25',
		['coche', 'medicacion', 'deseos', 'energia'],
		NOW
	);
	expect(off).toMatchObject({ car: null, medication: [], wishes: null, energy: null });
});

test('«Guardar como informe»: the blocks they see, without what is to come, never taken again', async () => {
	const ana = kitchen('ana');
	await db
		.update(familyMember)
		.set({ summary: { card: true, off: ['coche'] } })
		.where(sql`${familyMember.userId} = 'ana'`);
	// Energía, Deseos and Paseos start off for a family (nav.ts): not shown, not kept.
	const off = await summaryOff(ana, 'ana');
	expect(off).toEqual(['energia', 'coche', 'deseos', 'paseos']);

	const live = await summaryOf(ana, 'ana', 'semana', '2026-11-16', '2026-11-25', off, NOW);
	const id = await keepSummary(ana, 'ana', live);
	const kept = (await getReport(ana, 'ana', id))!;
	expect(kept).toMatchObject({
		title: 'Resumen, semana del 16 al 22 de noviembre',
		from: '2026-11-16',
		to: '2026-11-22'
	});
	const block = kept.pieces[0]!.block;
	if (block?.kind !== 'resumen') throw new Error('Sin el resumen');
	expect(block.summary).toMatchObject({
		car: null,
		energy: null,
		wishes: null,
		charges: [],
		next: null
	});
	// The family's fuel of the 21st and 22nd; Lucía's doses start on the 24th, after that week.
	expect(block.summary.money).toMatchObject({ total: 11_000, count: 2 });
	expect(block.summary.medication).toEqual([]);

	// A dose marked later does not change it.
	expect(await refreshReport(ana, 'ana', id)).toBe(false);
	// Not another's.
	expect(await getReport(kitchen('pepe'), 'pepe', id)).toBeNull();
});

test('«Ya está el resumen…»: on Monday and the 1st, once, only in the Buzón of who asked', async () => {
	expect(overToday('2026-11-23')).toEqual(['semana']);
	expect(overToday('2026-12-01')).toEqual(['mes']);
	expect(overToday('2026-06-01')).toEqual(['semana', 'mes']);
	expect(overToday('2026-11-25')).toEqual([]);

	await db
		.update(familyMember)
		.set({ summary: { card: true, off: [], notice: ['semana', 'mes'] } })
		.where(sql`${familyMember.userId} = 'ana'`);
	await sendSummaryNotices('A', '2026-11-23', NOW);
	// Again, after a restart: not twice; read, neither.
	await db.update(inbox).set({ readAt: new Date() });
	await sendSummaryNotices('A', '2026-11-23', NOW);
	const rows = await db.select().from(inbox);
	expect(rows.map((r) => [r.userId, r.kind, r.tag, r.url])).toEqual([
		['ana', 'resumen', 'resumen-semana-2026-11-16', '/preguntar/resumen?ver=semana&de=2026-11-16']
	]);
	expect(rows[0]!.title).toBe('Ya está el resumen de la semana del 16 al 22 de noviembre');
	// The family's fuel, Ana's and Pepe's; her trip of the 20th (the 23rd is the next week).
	expect(rows[0]!.body).toBe('110,00 € gastados · 80 km en coche.');
});
