import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { call, family, familyMember, familyPerson, pushSubscription, user } from './db/schema.ts';
import { familyOnlyScope, familyScope } from './family-scope.ts';
import { callHub } from './calls-hub.ts';
import { familyLinkScope } from './family-link-scope.ts';
import { parseCallMessage, type CallEvent } from '#lib/calls.ts';
import { iceServers } from './turn.ts';
import { createHmac } from 'node:crypto';

/**
 * The calls (#330), on a real Postgres (PGlite) as the app's role: who may call whom, what one side
 * sends the other, how each call ends, the history, and the notices (faked).
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const told: { to: string[]; title: string; body: string; sticky?: boolean; tag: string }[] = [];
const hub = callHub({
	withFamily,
	asFamily,
	notify: async (_family, to, m) => void told.push({ to, ...m }),
	links: familyLinkScope(db, { role: 'app_user' }),
	ringMs: 80,
	goneMs: 40
});

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
	await db.insert(user).values(['ana', 'pepe', 'lucia', 'otro'].map(account));
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pepe', familyId: 'A', role: 'member' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
	await db.insert(familyPerson).values([
		{ familyId: 'A', userId: 'ana', name: 'Ana' },
		{ familyId: 'A', userId: 'pepe', name: 'Pepe' },
		{ familyId: 'B', userId: 'otro', name: 'Otro' }
	]);
	await db
		.insert(pushSubscription)
		.values({ familyId: 'A', userId: 'pepe', endpoint: 'https://push/1', p256dh: 'k', auth: 'a' });
});

/** Each person's device, for the tests that do not need more than one. */
const dev = (userId: string) => `aparato-${userId}`;

/** A side's page, on one of their devices: what it heard. */
function page(userId: string, id: string, device = dev(userId)) {
	const heard: CallEvent[] = [];
	const stop = hub.join(userId, id, device, (e) => heard.push(e));
	return { heard, stop: stop! };
}

/** What a person asks, from their device. */
const say = (
	userId: string,
	id: string,
	m: Parameters<typeof hub.message>[2],
	device = dev(userId)
) => hub.message(userId, id, m, device);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function started(from: string, to: string) {
	const made = await hub.start(from, to, dev(from));
	if (!('id' in made) || 'problem' in made) throw new Error(JSON.stringify(made));
	return made.id;
}

describe('who can be called', () => {
	test('the family with an account, but oneself, by their name in the family', async () => {
		expect(await hub.callable('ana')).toEqual([
			{ userId: 'lucia', name: 'Cuenta lucia', notices: false },
			{ userId: 'pepe', name: 'Pepe', notices: true }
		]);
	});

	test('not oneself, nor someone of another family', async () => {
		expect(await hub.start('ana', 'ana', dev('ana'))).toEqual({
			problem: 'No te puedes llamar a ti.'
		});
		expect(await hub.start('ana', 'otro', dev('ana'))).toEqual({
			problem: 'No está en tu familia.'
		});
		expect(await hub.start('ana', 'nadie', dev('ana'))).toEqual({
			problem: 'No está en tu familia.'
		});
	});
});

describe('a call', () => {
	test('rings with a sticky notice, is answered, and relays what each side sends', async () => {
		told.length = 0;
		const id = await started('ana', 'pepe');
		expect(told[0]).toMatchObject({ to: ['pepe'], title: 'Ana te llama', sticky: true });

		const ana = page('ana', id);
		expect(ana.heard).toEqual([{ type: 'state', state: 'ringing' }]);
		// Nothing goes to the other before it is answered.
		expect(await say('ana', id, { type: 'offer', sdp: 'o' })).toBe('Todavía no han contestado.');
		// Someone else cannot answer it.
		expect(await say('lucia', id, { type: 'accept' })).toBe('La llamada ya terminó.');

		expect(await say('pepe', id, { type: 'accept' })).toBeNull();
		expect(ana.heard.at(-1)).toEqual({ type: 'state', state: 'connected' });
		// The offer, sent before Pepe's page listens, waits for it.
		await say('ana', id, { type: 'offer', sdp: 'oferta' });
		const pepe = page('pepe', id);
		expect(pepe.heard).toEqual([
			{ type: 'state', state: 'connected' },
			{ type: 'offer', sdp: 'oferta' }
		]);
		await say('pepe', id, { type: 'answer', sdp: 'respuesta' });
		expect(ana.heard.at(-1)).toEqual({ type: 'answer', sdp: 'respuesta' });

		await wait(100);
		// Answered, the ring's time does not end it.
		expect(hub.isIn('ana', id)).toBe(true);
		expect(await say('pepe', id, { type: 'hangup' })).toBeNull();
		expect(ana.heard.at(-1)).toEqual({ type: 'state', state: 'ended', outcome: 'answered' });
		expect(hub.isIn('ana', id)).toBe(false);
		const [row] = await db.select().from(call).where(eq(call.id, id));
		expect(row!.outcome).toBe('answered');
		expect(row!.answeredAt).not.toBeNull();
		expect(row!.endedAt).not.toBeNull();
	});

	test('unanswered, it is missed, and the notice says so', async () => {
		told.length = 0;
		const id = await started('pepe', 'ana');
		const pepe = page('pepe', id);
		await wait(120);
		expect(pepe.heard.at(-1)).toEqual({ type: 'state', state: 'ended', outcome: 'missed' });
		expect(told.at(-1)).toMatchObject({ to: ['ana'], title: 'Llamada perdida de Pepe' });
		expect(told.at(-1)!.tag).toBe(told[0]!.tag);
	});

	test('rejected, and busy while another lasts', async () => {
		const id = await started('ana', 'pepe');
		const second = await hub.start('lucia', 'pepe', dev('lucia'));
		expect(second).toMatchObject({ problem: 'Pepe está en otra llamada.' });
		expect(await hub.start('ana', 'lucia', dev('ana'))).toEqual({
			problem: 'Ya estás en una llamada.'
		});
		expect(await say('pepe', id, { type: 'reject' })).toBeNull();
		expect(await hub.info('ana', id)).toMatchObject({ state: 'ended', outcome: 'rejected' });
		const busy = (second as { id: string }).id;
		expect(await hub.info('lucia', busy)).toMatchObject({ state: 'ended', outcome: 'busy' });
	});

	test("the caller's page closed while it rings: cancelled after a moment", async () => {
		const id = await started('ana', 'lucia');
		const ana = page('ana', id);
		ana.stop();
		await wait(60);
		expect(await hub.info('ana', id)).toMatchObject({ state: 'ended', outcome: 'cancelled' });
	});

	test('a page back in time keeps the call', async () => {
		const id = await started('ana', 'lucia');
		page('ana', id).stop();
		const back = page('ana', id);
		await wait(60);
		expect(hub.isIn('ana', id)).toBe(true);
		await say('ana', id, { type: 'hangup' });
		expect(back.heard.at(-1)).toMatchObject({ outcome: 'cancelled' });
	});

	test('the open pages of the one called hear it ring, and stop', async () => {
		const seen: string[][] = [];
		const stop = hub.watchIncoming('lucia', (c) => seen.push(c.map((x) => x.fromName)));
		const id = await started('pepe', 'lucia');
		await say('pepe', id, { type: 'hangup' });
		stop();
		expect(seen).toEqual([[], ['Pepe'], []]);
	});
});

describe('several devices of the same person', () => {
	test('all ring; only the one that answered talks, and the other stops', async () => {
		const id = await started('ana', 'pepe');
		const phoneA = page('pepe', id, 'movil-pepe');
		const tablet = page('pepe', id, 'tablet-pepe');
		expect(await say('pepe', id, { type: 'accept' }, 'tablet-pepe')).toBeNull();
		// Both hear it was answered: the phone stops ringing.
		expect(phoneA.heard.at(-1)).toEqual({ type: 'state', state: 'connected' });
		await say('ana', id, { type: 'offer', sdp: 'oferta' });
		expect(tablet.heard.at(-1)).toEqual({ type: 'offer', sdp: 'oferta' });
		expect(phoneA.heard.some((e) => e.type === 'offer')).toBe(false);
		// The phone cannot talk in it.
		expect(await say('pepe', id, { type: 'answer', sdp: 'x' }, 'movil-pepe')).toBe(
			'La llamada está en otro aparato.'
		);
		// The phone's page closing does not end it; the tablet's does, after a moment.
		phoneA.stop();
		await wait(60);
		expect(hub.isIn('pepe', id)).toBe(true);
		tablet.stop();
		await wait(60);
		expect(await hub.info('pepe', id)).toMatchObject({ state: 'ended', outcome: 'answered' });
	});

	test('answering needs a device; rejecting from the notice does not', async () => {
		const id = await started('ana', 'pepe');
		expect(await hub.message('pepe', id, { type: 'accept' }, null)).toBe('Falta el aparato.');
		expect(await hub.message('pepe', id, { type: 'reject' }, null)).toBeNull();
		expect(await hub.info('ana', id)).toMatchObject({ outcome: 'rejected' });
	});
});

describe('the history', () => {
	test('their calls only, the newest first, with who and how', async () => {
		const mine = await hub.history('lucia');
		expect(mine.length).toBeGreaterThan(0);
		expect(mine.every((c) => c.otherName !== 'Lucía')).toBe(true);
		expect(mine[0]).toMatchObject({ outgoing: false, otherName: 'Pepe', outcome: 'cancelled' });
		const ana = await hub.history('ana');
		expect(ana.find((c) => c.outcome === 'answered')).toMatchObject({
			outgoing: true,
			otherName: 'Pepe'
		});
		expect(await hub.history('otro')).toEqual([]);
	});

	test("another's call is not theirs to open", async () => {
		const [one] = await hub.history('ana');
		expect(await hub.info('otro', one!.id)).toBeNull();
	});
});

describe('what a page may post', () => {
	test('signals and orders, checked', () => {
		expect(parseCallMessage({ type: 'accept' })).toEqual({ type: 'accept' });
		expect(parseCallMessage({ type: 'offer', sdp: 'v=0' })).toEqual({ type: 'offer', sdp: 'v=0' });
		expect(parseCallMessage({ type: 'offer', sdp: '' })).toBeNull();
		expect(parseCallMessage({ type: 'offer', sdp: 'x'.repeat(40_000) })).toBeNull();
		expect(
			parseCallMessage({
				type: 'ice',
				candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 }
			})
		).toEqual({
			type: 'ice',
			candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null }
		});
		expect(parseCallMessage({ type: 'ice', candidate: { candidate: '' } })).toMatchObject({
			type: 'ice'
		});
		expect(parseCallMessage({ type: 'ice', candidate: 'x' })).toBeNull();
		expect(parseCallMessage({ type: 'algo' })).toBeNull();
		expect(parseCallMessage(null)).toBeNull();
	});
});

describe("coturn's passwords", () => {
	test('none without coturn; STUN without its secret', () => {
		expect(iceServers('ana', {})).toEqual([]);
		expect(iceServers('ana', { host: 'turn.x' })).toEqual([{ urls: ['stun:turn.x:3478'] }]);
	});

	test("a day's, as coturn's REST API checks them", () => {
		const [, turn] = iceServers('ana', { host: 'turn.x', secret: 's', now: 1_000_000 });
		expect(turn!.username).toBe(`${1000 + 86_400}:ana`);
		expect(turn!.credential).toBe(
			createHmac('sha1', 's')
				.update(`${1000 + 86_400}:ana`)
				.digest('base64')
		);
		expect(turn!.urls).toContain('turn:turn.x:3478?transport=tcp');
	});
});
