import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import { messagesScope } from './messages-scope.ts';
import { MAX_TRIES, messagesBackupScope } from './messages-backup-scope.ts';
import {
	BackupKeeper,
	type BackupKeys,
	type BackupStore,
	type BackupTransport
} from '../mensajes/backup.ts';
import {
	Messenger,
	type DeviceKeys,
	type PrivatePackage,
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
// The KMS, as a label: the tests look at what is done with the key, not at Scaleway.
const backups = messagesBackupScope(withFamily, {
	seal: async (_f, text) => `sellado:${text}`,
	open: async (_f, sealed) => (sealed.startsWith('sellado:') ? sealed.slice(8) : null)
});

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
function memoryStore(): BackupStore & { all: StoredMessage[] } {
	let device: DeviceKeys | null = null;
	let packages: PrivatePackage[] = [];
	const groups = new Map<string, Uint8Array>();
	let cursor = 0;
	const all: StoredMessage[] = [];
	let backupKeys: BackupKeys | null = null;
	return {
		all,
		backupKeys: async () => backupKeys,
		setBackupKeys: async (k) => void (backupKeys = k),
		allMessages: async () => all,
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

const backupOf = (userId: string): BackupTransport => ({
	status: async () => {
		const s = await backups.status(userId);
		return { ...s, updatedAt: s.updatedAt?.toISOString() ?? null };
	},
	evaluate: (blinded) => backups.evaluate(userId, blinded),
	create: (c) => backups.create(userId, c),
	open: (proof) => backups.open(userId, proof),
	save: (c) => backups.save(userId, c),
	forget: () => backups.forget(userId)
});

let n = 0;
const device = (userId: string) => {
	const store = memoryStore();
	return {
		store,
		m: new Messenger(store, transportOf(userId), userId, () => `aparato-${userId}-${++n}`),
		backup: new BackupKeeper(store, backupOf(userId), userId)
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

describe('the backup behind a PIN', () => {
	test('a PIN of fewer than 6 digits is not taken', async () => {
		await expect(movil.backup.setPin('1234')).rejects.toThrow('6 cifras');
	});

	test('set on one device, a new one brings back what was said before', async () => {
		await movil.backup.setPin('482193');
		expect((await movil.backup.state()).backup).toBe(true);
		const nuevo = device('miguel');
		await nuevo.m.setup('Móvil nuevo');
		await expect(nuevo.backup.restore('111111')).rejects.toThrow('no es ese');
		expect((await nuevo.backup.state()).triesLeft).toBe(MAX_TRIES - 1);
		const came = await nuevo.backup.restore('482193');
		expect(came).toBeGreaterThan(0);
		expect(await texts(nuevo, conv)).toContain('miguel: Llego en diez minutos');
		expect((await nuevo.backup.state()).triesLeft).toBe(MAX_TRIES);
		// Up to date from either device: both kept, nothing lost.
		await nuevo.store.addMessage({
			conversationId: conv,
			key: 'local-1',
			userId: 'miguel',
			deviceId: 'x',
			text: 'Solo en el nuevo',
			at: new Date().toISOString(),
			mine: true
		});
		await nuevo.backup.save();
		await movil.backup.save();
		const third = device('miguel');
		await third.m.setup('Tablet');
		await third.backup.restore('482193');
		const all = await texts(third, conv);
		expect(all).toContain('miguel: Solo en el nuevo');
		expect(all).toContain('miguel: Llego en diez minutos');
	});

	test('the server holds neither the PIN nor what was said', async () => {
		const rows = JSON.stringify(await db.execute(sql`select * from msg_backup`));
		expect(rows).not.toContain('482193');
		expect(rows).not.toContain('diez minutos');
		expect(rows).not.toContain(btoa('Llego'));
	});

	test('someone else’s proof does not open it', async () => {
		await expect(backups.open('mama', (await movil.store.backupKeys())!.proof)).rejects.toThrow();
	});

	test('too many wrong PINs wipe it', async () => {
		const thief = device('miguel');
		await thief.m.setup('Ladrón');
		for (let i = 0; i < MAX_TRIES; i++)
			await expect(thief.backup.restore(`00000${i}`)).rejects.toThrow();
		await expect(thief.backup.restore('482193')).rejects.toThrow('Demasiados intentos');
		expect((await thief.backup.state()).backup).toBe(false);
		// The devices that kept it learn it at their next save, and can set a new PIN.
		await expect(movil.backup.save()).rejects.toThrow();
		expect((await movil.backup.state()).here).toBe(false);
		await movil.backup.setPin('739104');
		expect((await movil.backup.state()).backup).toBe(true);
	});
});
