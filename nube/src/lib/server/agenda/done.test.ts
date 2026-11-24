import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import * as schema from '#lib/server/db/schema.ts';
import { family } from '#lib/server/db/schema.ts';
import { familyOnlyScope } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** «Hecha» (#600): each repetition on its own, once it has come; on PGlite as the app's role. */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const kitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});
mock.module('#lib/server/db/index.ts', () => ({ db }));
mock.module('#lib/server/inbox.ts', () => ({ tell: async () => {} }));
mock.module('#lib/server/telegram/bot.ts', () => ({ tellGroup: async () => {} }));
const { addEvent, agendaBetween, setEventDone } = await import('./agenda.ts');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
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
});

test('marked and unmarked, only that day, not one to come nor another family’s', async () => {
	const k = kitchen('A');
	const today = localDay();
	const before = addDays(today, -7);
	const id = await addEvent(k, {
		title: 'Peluquería',
		notes: null,
		startDay: before,
		startTime: '10:00',
		endDay: null,
		endTime: null,
		repeat: { every: 'semana', days: [(new Date(`${before}T12:00:00Z`).getUTCDay() + 6) % 7] },
		remind: null,
		people: []
	});
	const days = async () => (await agendaBetween(k, before, today)).events[0]!.doneDays;
	expect(await setEventDone(k, id, before, true)).toEqual({ title: 'Peluquería' });
	expect(await setEventDone(k, id, before, true)).toBeNull();
	expect(await days()).toEqual([before]);
	// Not a day of it, one to come, another family's.
	expect(await setEventDone(k, id, addDays(before, 1), true)).toBeNull();
	expect(await setEventDone(k, id, addDays(today, 7), true)).toBeNull();
	expect(await setEventDone(kitchen('B'), id, today, true)).toBeNull();
	expect(await setEventDone(k, id, today, true)).not.toBeNull();
	expect(await setEventDone(k, id, before, false)).not.toBeNull();
	expect(await days()).toEqual([today]);
	expect(await setEventDone(k, id, before, false)).toBeNull();
});
