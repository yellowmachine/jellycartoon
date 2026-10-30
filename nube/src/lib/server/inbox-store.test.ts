import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';

/**
 * The «Buzón» (#331) on a real Postgres (PGlite) as the app's role: each one's only theirs, not
 * even the administrator's; a notice said again takes the unread one's place.
 */
import {
	answerProposal,
	keepInInbox,
	listInbox,
	markRead,
	removeFromInbox
} from './inbox-store.ts';

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

const unread = async (k: Kitchen, userId: string) =>
	(await listInbox(k, userId)).filter((n) => !n.readAt).length;

const notice = (title: string, tag = '') => ({
	kind: 'agenda' as const,
	title,
	body: 'A las 17:00',
	tag,
	url: '/agenda',
	ttl: 60
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

describe('inbox', () => {
	test('each one only theirs, not even the administrator sees the others', async () => {
		const ana = kitchen('ana');
		const alberto = kitchen('alberto');
		await keepInInbox(ana, ['alberto'], { ...notice('Dentista'), kind: 'recado' });
		expect((await listInbox(alberto, 'alberto')).map((n) => n.title)).toEqual(['Dentista']);
		expect(await listInbox(ana, 'ana')).toEqual([]);
		// Nor can she read it or take it out.
		const [n] = await listInbox(alberto, 'alberto');
		await markRead(ana, 'ana', n!.id);
		await removeFromInbox(ana, 'ana', n!.id);
		expect(await unread(alberto, 'alberto')).toBe(1);
		await markRead(alberto, 'alberto', n!.id);
		expect(await unread(alberto, 'alberto')).toBe(0);
		await removeFromInbox(alberto, 'alberto', n!.id);
		expect(await listInbox(alberto, 'alberto')).toEqual([]);
	});

	test('said again while unread: in its place; once read, a new one', async () => {
		const ana = kitchen('ana');
		await keepInInbox(ana, ['ana'], notice('Mañana: piscina', 'agenda-1'));
		await keepInInbox(ana, ['ana'], notice('En una hora: piscina', 'agenda-1'));
		expect((await listInbox(ana, 'ana')).map((n) => n.title)).toEqual(['En una hora: piscina']);
		await markRead(ana, 'ana');
		await keepInInbox(ana, ['ana'], notice('Mañana: piscina', 'agenda-1'));
		expect((await listInbox(ana, 'ana')).map((n) => n.title)).toEqual([
			'Mañana: piscina',
			'En una hora: piscina'
		]);
		expect(await unread(ana, 'ana')).toBe(1);
	});

	test('something offered to remember: answered once, only by its person (#331)', async () => {
		const ana = kitchen('ana');
		const proposal = {
			text: 'Los padres llegan el sábado',
			untilDay: null,
			because: 'de Telegram'
		};
		await keepInInbox(ana, ['ana'], { ...notice('¿Lo recuerdo?'), kind: 'propuesta', proposal });
		const [n] = await listInbox(ana, 'ana');
		expect(n!.proposal).toEqual(proposal);
		expect(await answerProposal(kitchen('alberto'), 'alberto', n!.id, true)).toBeNull();
		expect(await answerProposal(ana, 'ana', n!.id, true)).toEqual(proposal);
		expect(await answerProposal(ana, 'ana', n!.id, true)).toBeNull();
		const [after] = await listInbox(ana, 'ana');
		expect(after).toMatchObject({ proposal: null, title: '✓ Guardado en lo que la voz recuerda' });
		expect(after!.readAt).not.toBeNull();
	});
});
