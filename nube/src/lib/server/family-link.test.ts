import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { call, family, familyLink, familyMember, familyPerson, user } from './db/schema.ts';
import { familyOnlyScope, familyScope } from './family-scope.ts';
import { familyLinkScope } from './family-link-scope.ts';
import { callHub } from './calls-hub.ts';
import { callButtonStore } from './call-button.ts';

/**
 * Linked families (#464), on a real Postgres (PGlite) as the app's role: a link made, read and
 * accepted by an adult of the other family, never by a child nor by its own family; what each
 * family sees of the other; calls between their adults, each family with its own row; removed.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const links = familyLinkScope(db, { role: 'app_user' });
const told: { to: string[]; title: string }[] = [];
const hub = callHub({
	withFamily,
	asFamily,
	notify: async (_family, to, m) => void told.push({ to, title: m.title }),
	links,
	ringMs: 200,
	goneMs: 40
});
const buttons = callButtonStore(withFamily, links);

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
		{ id: 'A', name: 'Casa Ana' },
		{ id: 'P', name: 'Casa abuelos' },
		{ id: 'H', name: 'Casa hermana' }
	]);
	await db.insert(user).values(['ana', 'nino', 'abuela', 'abuelo', 'hermana', 'sola'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'nino', familyId: 'A', role: 'peque' },
		{ userId: 'abuela', familyId: 'P', role: 'admin' },
		{ userId: 'abuelo', familyId: 'P', role: 'member' },
		{ userId: 'hermana', familyId: 'H', role: 'member' }
	]);
	await db.insert(familyPerson).values([
		{ familyId: 'A', userId: 'ana', name: 'Ana' },
		{ familyId: 'A', userId: 'nino', name: 'Niño' },
		{ familyId: 'P', userId: 'abuela', name: 'Abuela Carmen' }
	]);
});

async function made(userId: string) {
	const link = await links.invite(userId);
	if (!link.ok) throw new Error(link.problem);
	return link.token;
}

describe('the link', () => {
	test('a child makes none', async () => {
		expect(await links.invite('nino')).toEqual({
			ok: false,
			problem: 'Esto lo hace alguien mayor de tu familia.'
		});
	});

	test('its own family, a child or someone without one cannot accept it', async () => {
		const token = await made('ana');
		expect(await links.byToken(token, 'ana')).toMatchObject({
			kind: 'blocked',
			problem: 'Es un enlace de tu propia familia',
			familyName: 'Casa Ana'
		});
		expect(await links.accept(token, 'nino')).toEqual({
			ok: false,
			problem: 'Esto lo hace alguien mayor de tu familia.'
		});
		expect(await links.accept(token, 'sola')).toEqual({
			ok: false,
			problem: 'Para vincular tu familia, primero tienes que estar en una'
		});
		expect(await links.byToken('no-existe', 'abuela')).toEqual({ kind: 'none' });
	});

	test('another family sees nothing of a link it has not been given', async () => {
		await made('ana');
		expect((await links.ofFamily('abuela')).waiting).toEqual([]);
		const seen = await withFamily('abuela', (tx) => tx.select().from(familyLink));
		expect(seen).toEqual([]);
	});

	test('accepted by an adult of the other family: both see it, with the other’s adults', async () => {
		const token = await made('ana');
		expect(await links.byToken(token, 'abuelo')).toMatchObject({
			kind: 'canAccept',
			familyName: 'Casa Ana',
			inviterName: 'Cuenta ana'
		});
		expect(await links.accept(token, 'abuelo')).toEqual({ ok: true, familyName: 'Casa Ana' });

		const ours = await links.ofFamily('ana');
		expect(ours.linked.map((f) => [f.familyName, f.people.map((p) => p.name)])).toEqual([
			['Casa abuelos', ['Abuela Carmen', 'Cuenta abuelo']]
		]);
		// Their children are not seen by the other family.
		const theirs = await links.ofFamily('abuela');
		expect(theirs.linked.map((f) => [f.familyName, f.people.map((p) => p.userId)])).toEqual([
			['Casa Ana', ['ana']]
		]);
		// A child sees no links.
		expect(await links.ofFamily('nino')).toEqual({ linked: [], waiting: [] });
	});

	test('used once; and the same two families are not linked twice', async () => {
		const used = await withFamily('ana', (tx) =>
			tx.select({ token: familyLink.token }).from(familyLink)
		);
		const token = used.find((u) => u.token)!.token!;
		expect(await links.accept(token, 'abuela')).toEqual({
			ok: false,
			problem: 'Vuestras familias ya están vinculadas'
		});
		const back = await made('abuela');
		expect(await links.accept(back, 'ana')).toEqual({
			ok: false,
			problem: 'Vuestras familias ya están vinculadas'
		});
	});

	test('lapsed after its days', async () => {
		const token = await made('hermana');
		await db
			.update(familyLink)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(familyLink.token, token));
		expect(await links.accept(token, 'ana')).toEqual({
			ok: false,
			problem: 'Este enlace caducó: pide que te manden otro'
		});
		expect((await links.ofFamily('hermana')).waiting.find((w) => w.token === token)?.expired).toBe(
			true
		);
	});

	test('in pairs: a family linked with two does not link those two', async () => {
		expect(await links.accept(await made('hermana'), 'ana')).toMatchObject({ ok: true });
		expect((await links.ofFamily('ana')).linked.map((f) => f.familyName)).toEqual([
			'Casa abuelos',
			'Casa hermana'
		]);
		expect((await links.ofFamily('hermana')).linked.map((f) => f.familyName)).toEqual(['Casa Ana']);
		expect((await links.ofFamily('abuela')).linked.map((f) => f.familyName)).toEqual(['Casa Ana']);
	});
});

describe('calls between linked families', () => {
	test('their adults are callable, under their family’s name; not by a child', async () => {
		const people = await hub.callable('ana');
		expect(people.filter((p) => p.family).map((p) => [p.family, p.userId])).toEqual([
			['Casa abuelos', 'abuela'],
			['Casa abuelos', 'abuelo'],
			['Casa hermana', 'hermana']
		]);
		expect((await hub.callable('nino')).some((p) => p.family)).toBe(false);
		expect(await hub.start('nino', 'abuela', 'x')).toEqual({ problem: 'No está en tu familia.' });
		// Nor a child of a linked family, nor a family linked with a linked one.
		expect(await hub.start('abuela', 'nino', 'x')).toEqual({ problem: 'No está en tu familia.' });
		expect(await hub.start('abuela', 'hermana', 'x')).toEqual({
			problem: 'No está en tu familia.'
		});
	});

	test('a call: each family has its row, and its own history', async () => {
		const started = await hub.start('ana', 'abuela', 'movil-ana');
		if (!('id' in started) || 'problem' in started) throw new Error(JSON.stringify(started));
		const id = started.id;
		expect(told.at(-1)).toEqual({ to: ['abuela'], title: 'Ana te llama' });
		expect(await hub.message('abuela', id, { type: 'accept' }, 'movil-abuela')).toBeNull();
		expect(await hub.message('ana', id, { type: 'hangup' }, 'movil-ana')).toBeNull();

		const rows = await db.select().from(call).where(eq(call.id, id));
		expect(rows.map((r) => [r.familyId, r.outcome, Boolean(r.answeredAt)]).sort()).toEqual([
			['A', 'answered', true],
			['P', 'answered', true]
		]);
		expect((await hub.history('ana'))[0]).toMatchObject({
			id,
			outgoing: true,
			otherName: 'Abuela Carmen',
			outcome: 'answered'
		});
		expect((await hub.history('abuela'))[0]).toMatchObject({
			id,
			outgoing: false,
			outcome: 'answered'
		});
		expect(await hub.info('abuela', id)).toMatchObject({ role: 'callee', state: 'ended' });
	});

	test('a favorite of the button may be of a linked family; not for a child', async () => {
		expect(await buttons.set('ana', 'ana', true, ['abuela', 'nino'])).toBeNull();
		expect((await buttons.of('ana'))?.favorites.map((f) => [f.userId, f.name])).toEqual([
			['abuela', 'Abuela Carmen'],
			['nino', 'Niño']
		]);
		expect(await buttons.set('ana', 'nino', true, ['abuela', 'ana'])).toBeNull();
		expect((await buttons.of('nino'))?.favorites.map((f) => f.userId)).toEqual(['ana']);
	});

	test('removed by either family: no longer callable, the history stays', async () => {
		const linkId = (await links.ofFamily('abuela')).linked[0].linkId;
		expect(await links.remove('nino', linkId)).toEqual({
			problem: 'Esto lo hace alguien mayor de tu familia.'
		});
		expect(await links.remove('abuelo', linkId)).toBeNull();
		expect((await links.ofFamily('ana')).linked.map((f) => f.familyName)).toEqual(['Casa hermana']);
		expect(await hub.start('ana', 'abuela', 'x')).toEqual({ problem: 'No está en tu familia.' });
		expect((await buttons.of('ana'))?.favorites.map((f) => f.userId)).toEqual(['nino']);
		expect((await hub.history('abuela')).length).toBe(1);
		expect((await hub.history('ana')).length).toBe(1);
	});
});
