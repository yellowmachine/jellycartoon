import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, familyPerson, kidGuardian, user } from './db/schema.ts';
import { familyOnlyScope, familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import { localDay, localTime } from 'comun/agenda.ts';
import type { MedicationInput } from 'comun/medication.ts';

/**
 * The family's medication (#308), on a real Postgres (PGlite) as the app's role: saved, marked,
 * and each dose's notice, once, to the right phones (faked).
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const told: {
	to: string[];
	title: string;
	body: string;
	actions?: { title: string; post: string }[];
}[] = [];
mock.module('#lib/server/push.ts', () => ({
	notify: async (_: string, to: string[], m: { title: string; body: string }) =>
		void told.push({ to, ...m })
}));

const {
	dosesFor,
	listMedication,
	markDose,
	pendingDosesOf,
	saveMedication,
	sendDueDoses,
	toldFor
} = await import('./medication.ts');

const kitchen = (userId: string): Kitchen => ({
	familyId: 'A',
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('ana');
const house: Kitchen = { familyId: 'A', userId: null, run: (fn) => asFamily('A', fn) };

const account = (id: string) => ({
	id,
	name: { ana: 'Ana', lucia: 'Lucía' }[id] ?? id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

const people: Record<string, string> = {};
const today = localDay();

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(user).values(['ana', 'pepe', 'lucia', 'otro'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pepe', familyId: 'A', role: 'member' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
	await db.insert(kidGuardian).values({ familyId: 'A', kidId: 'lucia', guardianId: 'ana' });
	const rows = await db
		.insert(familyPerson)
		.values([
			{ familyId: 'A', userId: 'ana', name: 'Ana' },
			{ familyId: 'A', userId: 'lucia', name: 'Lucía' },
			{ familyId: 'A', name: 'Bebé' },
			{ familyId: 'B', userId: 'otro', name: 'Otro' }
		])
		.returning();
	for (const r of rows) people[r.name] = String(r.id);
});

const pill = (personId: string, times: string[]): MedicationInput => ({
	personId,
	name: 'Sintrom',
	dose: '½ pastilla',
	times,
	days: [],
	startDay: today,
	endDay: null
});

describe('medication', () => {
	test('only for a person of its own family', async () => {
		expect(await saveMedication(ana, null, pill(people.Otro!, ['08:00']))).toBeNull();
		expect(await saveMedication(ana, null, pill(people.Ana!, ['08:00', '22:00']))).toBeNumber();
		expect(await listMedication(kitchen('otro'))).toEqual([]);
	});

	test("a grown-up's to their phone; a child's to its adults, or to every grown-up", async () => {
		expect(await toldFor(house, Number(people.Ana))).toEqual(['ana']);
		expect(await toldFor(house, Number(people['Lucía']))).toEqual(['ana']);
		expect((await toldFor(house, Number(people['Bebé']))).sort()).toEqual(['ana', 'pepe']);
	});

	test('marked, and not again', async () => {
		const [m] = await listMedication(ana, Number(people.Ana));
		expect(await markDose(ana, m!.id, today, '09:00', true)).toBe(false);
		expect(await markDose(ana, m!.id, today, '08:00', true)).toBe(true);
		const [first, second] = await dosesFor(ana, [m!], today);
		expect(first).toMatchObject({ time: '08:00', takenBy: 'Ana' });
		expect(first!.takenAt).toMatch(/^\d\d:\d\d$/);
		expect(second).toMatchObject({ time: '22:00', takenAt: null });
		await markDose(ana, m!.id, today, '08:00', false);
		const [again] = await dosesFor(ana, [m!], today);
		expect(again!.takenAt).toBeNull();
	});

	test("one notice for a person's doses at a time, once; none if already marked", async () => {
		const now = localTime();
		const id = await saveMedication(ana, null, {
			...pill(people['Lucía']!, [now]),
			name: 'Dalsy',
			dose: '5 ml'
		});
		const other = await saveMedication(ana, null, {
			...pill(people['Lucía']!, [now]),
			name: 'Apiretal',
			dose: null
		});
		const early = await saveMedication(ana, null, { ...pill(people.Ana!, [now]), name: 'Hierro' });
		await markDose(ana, early!, today, now, true);
		told.length = 0;
		await sendDueDoses(house);
		await sendDueDoses(house);
		expect(told).toHaveLength(1);
		expect(told[0]).toMatchObject({
			to: ['ana'],
			title: `💊 Lucía, ${now}`,
			body: 'Dalsy (5 ml) · Apiretal'
		});
		expect(told[0]!.actions?.[0]).toMatchObject({
			title: '✓ Tomadas',
			post: `/api/medicacion/tomada?dia=${today}&hora=${encodeURIComponent(now)}&id=${id}&id=${other}`
		});
	});

	test("the home page's: only what is told to each grown-up, not taken yet", async () => {
		await saveMedication(ana, null, { ...pill(people['Bebé']!, ['23:59']), name: 'Vitamina D' });
		const of = async (userId: string) =>
			(await pendingDosesOf(kitchen(userId), userId)).map((d) => `${d.name} ${d.time}`);
		// Ana: her Sintrom's 08:00 and 22:00 (not her Hierro, taken), Lucía's Dalsy, the baby's.
		expect(await of('ana')).toEqual(
			expect.arrayContaining(['Sintrom 08:00', 'Sintrom 22:00', 'Vitamina D 23:59'])
		);
		expect((await of('ana')).some((d) => d.startsWith('Dalsy'))).toBe(true);
		expect((await of('ana')).some((d) => d.startsWith('Hierro'))).toBe(false);
		// Pepe: only the baby's, who has no adults of its own.
		expect(await of('pepe')).toEqual(['Vitamina D 23:59']);
	});
});
