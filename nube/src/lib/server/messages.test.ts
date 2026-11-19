import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
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
	bookRecipeCard,
	describe as describeMessage,
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
/** Whom one may write to, as calls.callable says it in the app: the family, and the linked abuela. */
const LINKED: Record<string, string> = { miguel: 'abuela', abuela: 'miguel' };
const server = messagesScope(withFamily, async (userId, otherId) => {
	const [me] = await db.select().from(familyMember).where(eq(familyMember.userId, userId));
	const [other] = await db.select().from(familyMember).where(eq(familyMember.userId, otherId));
	if (!me || !other) return null;
	if (me.familyId === other.familyId || LINKED[userId] === otherId)
		return { familyId: other.familyId };
	return null;
});
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
		{ id: 'B', name: 'Otra' },
		{ id: 'C', name: 'Casa abuela' }
	]);
	await db.insert(user).values(['miguel', 'mama', 'nino', 'vecino', 'abuela'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'miguel', familyId: 'A', role: 'admin' },
		{ userId: 'mama', familyId: 'A', role: 'member' },
		{ userId: 'nino', familyId: 'A', role: 'peque' },
		{ userId: 'vecino', familyId: 'B', role: 'admin' },
		{ userId: 'abuela', familyId: 'C', role: 'admin' }
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

/** The families' storage (area `mensajes`), in memory: what /api/mensajes/archivo keeps. */
const files = new Map<string, Uint8Array>();

/** What /api/mensajes does, for this person. */
const transportOf = (userId: string): Transport => ({
	register: (d) => server.registerDevice(userId, d),
	familyConversation: (deviceId) => server.familyConversation(userId, deviceId),
	pairConversation: (deviceId, otherId) => server.pairConversation(userId, deviceId, otherId),
	conversations: () => server.conversations(userId),
	conversation: (deviceId, id) => server.conversation(userId, deviceId, id),
	claim: (deviceId, id, ids) => server.claimKeyPackages(userId, deviceId, id, ids),
	commit: (deviceId, c) => server.postCommit(userId, deviceId, c),
	send: (deviceId, m) => server.postMessage(userId, deviceId, m),
	events: (deviceId, since) => server.events(userId, deviceId, since),
	uploadFile: async (deviceId, conversationId, sealed) => {
		const f = await server.addFile(userId, deviceId, conversationId, sealed.length);
		files.set(`${f.familyId}/${f.id}`, sealed);
		return { id: f.id };
	},
	downloadFile: async (conversationId, file) => {
		const familyId = await server.fileFor(userId, conversationId, file);
		return files.get(`${familyId}/${file}`)!;
	}
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

describe('two people’s conversations', () => {
	let pair = '';
	test('Miguel and Mamá: only they read it, not the rest of the family', async () => {
		pair = await movil.m.pair('mama');
		await mama.m.lookAll(); // She makes its group, with Miguel's devices.
		await movil.m.sync();
		await mama.m.send(pair, 'Esto solo para ti');
		await movil.m.sync();
		expect(await texts(movil, pair)).toEqual(['mama: Esto solo para ti']);
		const nino = device('nino');
		await nino.m.setup('Otra tablet del niño');
		await nino.m.lookAll();
		await nino.m.sync();
		expect(await texts(nino, pair)).toEqual([]);
		await expect(server.conversation('nino', (await nino.m.device())!.id, pair)).rejects.toThrow(
			'No estás'
		);
	});

	test('with a linked family: kept in both, read by both, by no one else', async () => {
		const abuela = device('abuela');
		await abuela.m.setup('Móvil de la abuela');
		const conv2 = await movil.m.pair('abuela');
		expect(conv2).toBe('pareja-abuela-miguel');
		await abuela.m.lookAll();
		await movil.m.sync();
		await movil.m.send(conv2, 'Abuela, llegamos el sábado');
		await abuela.m.sync();
		expect(await texts(abuela, conv2)).toEqual(['miguel: Abuela, llegamos el sábado']);
		await abuela.m.send(conv2, '¡Qué bien, hijo!');
		await movil.m.sync();
		expect((await texts(movil, conv2)).at(-1)).toBe('abuela: ¡Qué bien, hijo!');
		// Each family's queue has it; Mamá, in Miguel's family but not in it, reads nothing of it.
		await mama.m.sync();
		expect(await texts(mama, conv2)).toEqual([]);
		const both = await db.execute(
			sql`select distinct family_id from msg_event where conversation_id = ${conv2}`
		);
		expect(JSON.stringify(both)).toContain('"C"');
		expect(JSON.stringify(both)).toContain('"A"');
	});

	test('nobody else may open one with them', async () => {
		const other = device('vecino');
		await other.m.setup('Otro móvil del vecino');
		await expect(other.m.pair('miguel')).rejects.toThrow('No puedes escribir');
		await expect(movil.m.pair('miguel')).rejects.toThrow();
	});

	test('two sending at once: both read, in the same order everywhere', async () => {
		await Promise.all([movil.m.send(pair, 'A la vez 1'), mama.m.send(pair, 'A la vez 2')]);
		await movil.m.sync();
		await mama.m.sync();
		const a = (await texts(movil, pair)).slice(-2).sort();
		const b = (await texts(mama, pair)).slice(-2).sort();
		expect(a).toEqual(['mama: A la vez 2', 'miguel: A la vez 1']);
		expect(b).toEqual(['mama: A la vez 2', 'miguel: A la vez 1']);
	});
});

describe('voice notes', () => {
	test('encrypted with their own key: the storage cannot open them, those in it can', async () => {
		const sound = new Uint8Array(50_000).map((_, i) => (i * 7) & 255);
		const abuela = device('abuela');
		await abuela.m.setup('Tablet de la abuela');
		await abuela.m.lookAll(); // Not in yet: Miguel's device lets her new one in.
		await movil.m.lookAll();
		await abuela.m.sync();
		const conv2 = 'pareja-abuela-miguel';
		const sent = await movil.m.sendAudio(conv2, sound, 'audio/webm;codecs=opus', 4.2);
		expect(sent?.audio?.seconds).toBe(4);
		// Kept in Miguel's family's storage, encrypted.
		const kept = [...files.entries()].find(([k]) => k.endsWith(sent!.audio!.file));
		expect(kept![0].startsWith('A/')).toBe(true);
		expect(Buffer.from(kept![1]).includes(Buffer.from(sound.subarray(0, 64)))).toBe(false);
		// The abuela, of a linked family, hears it.
		await abuela.m.sync();
		const got = (await abuela.m.messages(conv2)).at(-1)!;
		expect(got.audio?.seconds).toBe(4);
		const heard = new Uint8Array(await (await abuela.m.audio(got)).arrayBuffer());
		expect(heard).toEqual(sound);
		// Mamá, not in that conversation, may not even download it.
		await expect(server.fileFor('mama', conv2, sent!.audio!.file)).rejects.toThrow();
	});

	test('a photo (#555): encrypted with its own key, only those in it see it', async () => {
		const jpeg = new Uint8Array(30_000).map((_, i) => (i * 13) & 255);
		const sent = await mama.m.sendPhoto(conv, jpeg, 'image/jpeg', 1600, 1200);
		expect(sent?.photo).toMatchObject({ width: 1600, height: 1200, mime: 'image/jpeg' });
		const kept = [...files.entries()].find(([k]) => k.endsWith(sent!.photo!.file));
		expect(Buffer.from(kept![1]).includes(Buffer.from(jpeg.subarray(0, 64)))).toBe(false);
		await movil.m.sync();
		const got = (await movil.m.messages(conv)).at(-1)!;
		expect(got.photo).toMatchObject({ width: 1600, height: 1200 });
		expect(describeMessage(got)).toBe('📷 Foto');
		expect(new Uint8Array(await (await movil.m.photo(got)).arrayBuffer())).toEqual(jpeg);
	});

	test('where someone is (#555): inside the encrypted message, nothing else is kept', async () => {
		const sent = await mama.m.sendPlace(conv, {
			lat: 37.98765432,
			lon: -1.12987654,
			accuracy: 12.4
		});
		expect(sent?.place).toEqual({ lat: 37.987654, lon: -1.129877, accuracy: 12 });
		await movil.m.sync();
		const got = (await movil.m.messages(conv)).at(-1)!;
		expect(got.place).toEqual({ lat: 37.987654, lon: -1.129877, accuracy: 12 });
		expect(describeMessage(got)).toBe('📍 Ubicación');
		expect(JSON.stringify(await db.execute(sql`select data from msg_event`))).not.toContain(
			'37.98'
		);
		await expect(mama.m.sendPlace(conv, { lat: 120, lon: 0 })).rejects.toThrow();
	});

	test('a recipe or a list (#555): inside the encrypted message, checked when read', async () => {
		const recipe = {
			title: 'Tarta de chocolate',
			servings: 8,
			ingredients: ['200 g de chocolate'],
			steps: [{ text: 'Funde el chocolate', timer: null }]
		};
		const sent = await mama.m.sendCard(conv, { kind: 'receta', recipe });
		expect(sent?.card).toEqual({ kind: 'receta', recipe });
		await mama.m.sendCard(conv, { kind: 'compra', items: [' Crema ', '', 'Toallas'] });
		await movil.m.sync();
		const [r, l] = (await movil.m.messages(conv)).slice(-2);
		expect(r!.card).toEqual({ kind: 'receta', recipe });
		expect(describeMessage(r!)).toBe('🍰 Receta: Tarta de chocolate');
		expect(l!.card).toEqual({ kind: 'compra', items: ['Crema', 'Toallas'] });
		expect(JSON.stringify(await db.execute(sql`select data from msg_event`))).not.toContain(
			'chocolate'
		);
		await expect(mama.m.sendCard(conv, { kind: 'compra', items: [] })).rejects.toThrow();
	});

	test('a recipe of the book (#555): a link within the family, the whole of it to a linked one', async () => {
		const saved = {
			id: 7,
			recipe: { title: 'Lentejas', servings: 4, ingredients: ['lentejas'], steps: [] }
		};
		expect(bookRecipeCard(saved, true)).toEqual({
			kind: 'enlace-receta',
			id: 7,
			title: 'Lentejas'
		});
		expect(bookRecipeCard(saved, false)).toEqual({ kind: 'receta', recipe: saved.recipe });
		await mama.m.sendCard(conv, bookRecipeCard(saved, true));
		await movil.m.sync();
		const got = (await movil.m.messages(conv)).at(-1)!;
		expect(got.card).toEqual({ kind: 'enlace-receta', id: 7, title: 'Lentejas' });
		expect(describeMessage(got)).toBe('🍰 Receta: Lentejas');
		await expect(
			mama.m.sendCard(conv, { kind: 'enlace-receta', id: -1, title: 'x' })
		).rejects.toThrow();
	});

	test('a plan (#555): inside the encrypted message, checked when read', async () => {
		const cita = {
			kind: 'cita' as const,
			title: 'Comida en casa de la abuela',
			day: '2026-11-21',
			time: '14:00',
			endTime: null,
			notes: null
		};
		await mama.m.sendCard(conv, cita);
		await movil.m.sync();
		const got = (await movil.m.messages(conv)).at(-1)!;
		expect(got.card).toEqual(cita);
		expect(describeMessage(got)).toBe(
			'📅 Comida en casa de la abuela, sábado, 21 de noviembre, 14:00'
		);
		await expect(mama.m.sendCard(conv, { ...cita, day: 'sábado' })).rejects.toThrow();
	});

	test('with its text, made by the sender («los dos»): it comes with it, encrypted', async () => {
		const sound = new Uint8Array(4_000).map((_, i) => i & 255);
		const sent = await mama.m.sendAudio(conv, sound, 'audio/webm', 2, 'Que bajes a cenar');
		expect(sent?.transcript).toBe('Que bajes a cenar');
		await movil.m.sync();
		const got = (await movil.m.messages(conv)).at(-1)!;
		expect(got.audio?.seconds).toBe(2);
		expect(got.transcript).toBe('Que bajes a cenar');
		expect(JSON.stringify(await db.execute(sql`select data from msg_event`))).not.toContain(
			btoa('Que bajes')
		);
	});
});

describe('the page and its service worker, one device', () => {
	test('both syncing at once, with the shared lock: nothing read twice, nothing lost', async () => {
		// One device's store, read by two (the page and the worker), with one lock, as Web Locks.
		let chain: Promise<unknown> = Promise.resolve();
		const lock = <T>(fn: () => Promise<T>): Promise<T> => {
			const run = chain.then(fn, fn);
			chain = run.catch(() => {});
			return run;
		};
		const store = memoryStore();
		const page = new Messenger(
			store,
			transportOf('miguel'),
			'miguel',
			() => `aparato-uno-${++n}`,
			lock
		);
		const worker = new Messenger(store, transportOf('miguel'), 'miguel', undefined, lock);
		await page.setup('Móvil con su worker');
		await page.family();
		await mama.m.lookAll();
		await page.sync();
		for (const t of ['uno', 'dos', 'tres']) await mama.m.send(conv, `Seguidos ${t}`);
		await Promise.all([page.sync(), worker.sync(), page.sync(), worker.sync()]);
		const got = (await page.messages(conv))
			.map((m) => m.text)
			.filter((t) => t.startsWith('Seguidos'));
		expect(got).toEqual(['Seguidos uno', 'Seguidos dos', 'Seguidos tres']);
		// And the group is still right: what comes next is read too.
		await mama.m.send(conv, 'Y otro después');
		await worker.sync();
		expect((await page.messages(conv)).at(-1)?.text).toBe('Y otro después');
	});
});

describe('a group changed while sending', () => {
	test('the server says it is stale; the device catches up, makes it again, and it is read', async () => {
		const base = transportOf('mama');
		let once = true;
		const racing: Transport = {
			...base,
			send: async (deviceId, msg) => {
				// Right then, another device of the family comes, and Miguel's lets it in.
				if (once) {
					once = false;
					const other = device('miguel');
					await other.m.setup('Otro aparato más');
					await movil.m.family();
				}
				return base.send(deviceId, msg);
			}
		};
		const sender = new Messenger(mama.store, racing, 'mama');
		const sent = await sender.send(conv, 'Llegó a pesar del cambio');
		expect(sent?.text).toBe('Llegó a pesar del cambio');
		await movil.m.sync();
		expect((await movil.m.messages(conv)).at(-1)?.text).toBe('Llegó a pesar del cambio');
	});
});
