import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, familyPerson, user } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import { callButtonStore } from './call-button.ts';

/** The call button (#330), on a real Postgres (PGlite) as the app's role. */
const db = drizzle(new PGlite(), { schema });
const store = callButtonStore(familyScope(db, { role: 'app_user' }), { linked: async () => [] });

const account = (id: string) => ({
	id,
	name: `Cuenta ${id}`,
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
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(user).values(['ana', 'abuela', 'pepe', 'lucia', 'otro'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'abuela', familyId: 'A', role: 'member' },
		{ userId: 'pepe', familyId: 'A', role: 'member' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
	await db.insert(familyPerson).values([
		{ familyId: 'A', userId: 'ana', name: 'Ana', avatar: 'gato' },
		{ familyId: 'A', userId: 'abuela', name: 'Abuela' }
	]);
});

describe('botón de llamar', () => {
	test('apagado de inicio', async () => {
		expect(await store.of('abuela')).toBeNull();
		expect((await store.all('ana')).every((b) => !b.on && !b.favorites.length)).toBe(true);
	});

	test('otro adulto lo enciende con sus favoritos, en su orden y con el nombre de la familia', async () => {
		expect(await store.set('ana', 'abuela', true, ['pepe', 'ana'])).toBeNull();
		expect(await store.of('abuela')).toEqual({
			favorites: [
				{ userId: 'pepe', name: 'Cuenta pepe', avatar: null },
				{ userId: 'ana', name: 'Ana', avatar: 'gato' }
			]
		});
	});

	test('sin sí mismo, sin repetidos, sin los de otra familia y como mucho tres', async () => {
		await store.set('abuela', 'abuela', true, [
			'abuela',
			'otro',
			'pepe',
			'pepe',
			'ana',
			'lucia',
			'nadie'
		]);
		const mine = (await store.all('abuela')).find((b) => b.userId === 'abuela');
		expect(mine).toEqual({
			userId: 'abuela',
			on: true,
			kid: false,
			favorites: ['pepe', 'ana', 'lucia']
		});
	});

	test('un peque no lo cambia, ni nadie el de otra familia', async () => {
		expect(await store.set('lucia', 'lucia', true, [])).toEqual({
			problem: 'Esto lo cambia alguien mayor de tu familia.'
		});
		expect(await store.set('otro', 'abuela', false, [])).toEqual({
			problem: 'No está en tu familia.'
		});
		expect(await store.of('abuela')).not.toBeNull();
		expect(await store.all('otro')).toEqual([
			{ userId: 'otro', on: false, kid: false, favorites: [] }
		]);
	});

	test('apagado, no sale; un favorito que se fue, deja de salir', async () => {
		await db.execute(sql`update family_member set family_id = 'B' where user_id = 'pepe'`);
		expect((await store.of('abuela'))?.favorites.map((f) => f.userId)).toEqual(['ana', 'lucia']);
		await store.set('ana', 'abuela', false, ['ana']);
		expect(await store.of('abuela')).toBeNull();
	});
});
