import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import { messagesScope } from './messages-scope.ts';
import {
	Messenger,
	type DeviceKeys,
	type PrivatePackage,
	type Store,
	type StoredMessage,
	type Transport
} from '../mensajes/messenger.ts';

/**
 * Mensajes (#551) end to end, on a real Postgres (PGlite) as the app's role: the delivery service
 * (messages-scope.ts) and several devices (messenger.ts, as in the browser, with their keys in
 * memory instead of IndexedDB). The server only ever holds ciphertext.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const server = messagesScope(withFamily);

const account = (id: string) => ({
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
	await db.insert(family).values([
		{ id: 'A', name: 'Casa' },
		{ id: 'B', name: 'Otra' }
	]);
	await db.insert(user).values(['miguel', 'mama', 'nino', 'vecino'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'miguel', familyId: 'A', role: 'admin' },
		{ userId: 'mama', familyId: 'A', role: 'member' },
		{ userId: 'nino', familyId: 'A', role: 'peque' },
		{ userId: 'vecino', familyId: 'B', role: 'admin' }
	]);
});

/** A device's IndexedDB, in memory. */
function memoryStore(): Store & { all: StoredMessage[] } {
	let device: DeviceKeys | null = null;
	let packages: PrivatePackage[] = [];
	const groups = new Map<string, Uint8Array>();
	let cursor = 0;
	const all: StoredMessage[] = [];
	return {
		all,
		device: async () => device,
		setDevice: async (d) => void (device = d),
		packages: async () => packages,
		setPackages: async (p) => void (packages = p),
		group: async (id) => groups.get(id) ?? null,
		setGroup: async (id, s) => void groups.set(id, s),
		removeGroup: async (id) => void groups.delete(id),
		cursor: async () => cursor,
		setCursor: async (n) => void (cursor = n),
		addMessage: async (m) => void all.push(m),
		messages: async (id) => all.filter((m) => m.conversationId === id)
	};
}

/** What /api/mensajes does, for this person. */
const transportOf = (userId: string): Transport => ({
	register: (d) => server.registerDevice(userId, d),
	familyConversation: (deviceId) => server.familyConversation(userId, deviceId),
	conversation: (deviceId, id) => server.conversation(userId, deviceId, id),
	claim: (deviceId, id, ids) => server.claimKeyPackages(userId, deviceId, id, ids),
	commit: (deviceId, c) => server.postCommit(userId, deviceId, c),
	send: (deviceId, m) => server.postMessage(userId, deviceId, m),
	events: (deviceId, since) => server.events(userId, deviceId, since)
});

let n = 0;
const device = (userId: string) => {
	const store = memoryStore();
	return {
		store,
		m: new Messenger(store, transportOf(userId), userId, () => `aparato-${userId}-${++n}`)
	};
};
const texts = async (d: ReturnType<typeof device>, conv: string) =>
	(await d.m.messages(conv)).map((x) => `${x.userId}: ${x.text}`);

const movil = device('miguel');
const tablet = device('miguel');
const mama = device('mama');
let conv = '';

describe('the family’s conversation', () => {
	test('the first device makes its group alone; the second one in adds the first', async () => {
		await movil.m.setup('Móvil');
		conv = await movil.m.family();
		expect(conv).toBe('familia-A');
		await mama.m.setup('Móvil de mamá');
		await mama.m.family();
		await movil.m.sync();
		await mama.m.send(conv, 'Hola, ¿me leéis?');
		await movil.m.sync();
		expect(await texts(movil, conv)).toEqual(['mama: Hola, ¿me leéis?']);
	});

	test('a new device of Miguel’s is added by one already in, and reads from then on', async () => {
		await tablet.m.setup('Tablet del coche');
		await tablet.m.family(); // Not in the group yet: its welcome will come.
		await movil.m.family(); // Sees it missing, and adds it.
		await movil.m.send(conv, 'Llego en diez minutos');
		await tablet.m.sync();
		await mama.m.sync();
		expect(await texts(tablet, conv)).toEqual(['miguel: Llego en diez minutos']);
		expect(await texts(mama, conv)).toEqual([
			'mama: Hola, ¿me leéis?',
			'miguel: Llego en diez minutos'
		]);
		// What one of his devices sent shows as his own on the other.
		expect((await tablet.m.messages(conv))[0]!.mine).toBe(true);
	});

	test('the server holds only ciphertext', async () => {
		const rows = await db.execute(sql`select data from msg_event`);
		const all = JSON.stringify(rows);
		expect(all).not.toContain('diez minutos');
		expect(all).not.toContain(btoa('Llego'));
	});

	test('a lost device taken out reads nothing more', async () => {
		const lost = (await tablet.m.device())!.id;
		await server.revokeDevice('miguel', lost);
		await mama.m.family(); // Sees it gone, and takes it out.
		await movil.m.sync();
		await mama.m.send(conv, 'La tablet ya no está');
		await movil.m.sync();
		expect((await texts(movil, conv)).at(-1)).toBe('mama: La tablet ya no está');
		// The lost one is not even let in to ask.
		await expect(tablet.m.sync()).rejects.toThrow();
		expect(await texts(tablet, conv)).toEqual(['miguel: Llego en diez minutos']);
	});

	test('two devices changing the group at once: one wins, the other catches up', async () => {
		const nino = device('nino');
		await nino.m.setup('Tablet del niño');
		await nino.m.family();
		// Both see the child's device missing and add it at the same time.
		await Promise.all([movil.m.family(), mama.m.family()]);
		await movil.m.sync();
		await mama.m.sync();
		await nino.m.sync();
		await mama.m.send(conv, 'A cenar');
		await nino.m.sync();
		await movil.m.sync();
		expect((await texts(nino, conv)).at(-1)).toBe('mama: A cenar');
		expect((await texts(movil, conv)).at(-1)).toBe('mama: A cenar');
	});

	test('another family sees none of it', async () => {
		const other = device('vecino');
		await other.m.setup('Móvil del vecino');
		expect(await server.events('vecino', (await other.m.device())!.id, 0)).toEqual([]);
		await expect(
			server.conversation('vecino', (await other.m.device())!.id, conv)
		).rejects.toThrow();
		// Nor anyone with someone else’s device.
		await expect(server.events('vecino', (await movil.m.device())!.id, 0)).rejects.toThrow();
	});
});
