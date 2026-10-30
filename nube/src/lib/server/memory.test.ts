import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import { addDays, localDay } from 'comun/agenda.ts';
import { forget, forgetOver, listMemories, recallMemories, remember } from './memory.ts';

/**
 * What the voice remembers, on a real Postgres (PGlite) as the app's role: each person's only
 * theirs, not even the administrator's; the house's, everyone's.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const kitchen = (userId: string): Kitchen => ({
	familyId: 'A',
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});

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
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'alberto'].map(person));
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'alberto', familyId: 'A' }
	]);
});

describe('memory', () => {
	test('each one only theirs, and the house for all', async () => {
		const ana = kitchen('ana');
		const alberto = kitchen('alberto');
		const key = await remember(alberto, null, 'La llave de repuesto está en la maceta');
		const mine = await remember(alberto, 'alberto', 'La contraseña del wifi del trabajo es pato');
		// The administrator does not see Alberto's.
		expect((await listMemories(ana, 'ana')).map((m) => m.id)).toEqual([key!]);
		expect((await listMemories(alberto, 'alberto')).map((m) => m.id).sort()).toEqual(
			[key!, mine!].sort()
		);
		// A satellite: the house's only.
		expect((await listMemories(alberto, null)).map((m) => m.id)).toEqual([key!]);
		// Nor can she forget it.
		expect(await forget(ana, 'ana', mine!)).toBeNull();
		expect(await forget(alberto, 'alberto', mine!)).toBe(
			'La contraseña del wifi del trabajo es pato'
		);
	});

	test('in the order, by the words of a question', async () => {
		const text = await recallMemories(kitchen('ana'), 'ana', '¿Dónde está la llave?');
		expect(text).toContain('La llave de repuesto está en la maceta');
		expect(text).toContain('(de la casa)');
	});

	test('only for some days (#331): told from its first to its last, then forgotten', async () => {
		const ana = kitchen('ana');
		const today = localDay();
		const car = await remember(ana, 'ana', 'El coche está en el taller', {
			untilDay: addDays(today, 2)
		});
		const later = await remember(ana, 'ana', 'La llave de la oficina la tiene Luis', {
			fromDay: addDays(today, 3)
		});
		const over = await remember(ana, 'ana', 'El perro está con la vecina', {
			untilDay: addDays(today, -1)
		});
		const ids = async (later: boolean) => (await listMemories(ana, 'ana', later)).map((m) => m.id);
		// Today: the car, not what begins later nor what was over yesterday.
		expect(await ids(false)).toContain(car!);
		expect(await ids(false)).not.toContain(later!);
		expect(await ids(false)).not.toContain(over!);
		// Ajustes: what begins later too.
		expect(await ids(true)).toContain(later!);
		expect(await recallMemories(ana, 'ana', '¿Dónde está el coche?')).toContain(
			`hasta el ${addDays(today, 2)}`
		);
		// At midnight, what was over goes; the rest stays.
		expect(await forgetOver(ana)).toBe(1);
		expect(await ids(true)).toContain(car!);
		// A last day before the first: the order said it the other way round.
		const odd = await remember(ana, 'ana', 'Algo raro', {
			fromDay: addDays(today, 1),
			untilDay: today
		});
		const [m] = (await listMemories(ana, 'ana', true)).filter((m) => m.id === odd);
		expect(m?.untilDay).toBeNull();
	});
});
