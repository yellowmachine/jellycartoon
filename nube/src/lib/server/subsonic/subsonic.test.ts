import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { family, familyMember, musicSource, ownAlbum, ownTrack, user } from '../db/schema.ts';
import { familyOnlyScope, familyScope, userScope } from '../family-scope.ts';
import { userSecrets } from '../user-secret-scope.ts';
import { eq } from 'drizzle-orm';

/**
 * The families' buckets in music apps (#625), on a real Postgres (PGlite) with RLS as the app's
 * role: who gets in, and that a family never sees nor hears another's, whatever ids it tries.
 */
const db = drizzle(new PGlite(), { schema });
const role = 'app_user';
const asFamily = familyOnlyScope(db, { role });
const asUser = userScope(db, { role });
const withFamily = familyScope(db, { role });

mock.module('#lib/server/family.ts', () => ({ asFamily, asUser, withFamily }));
mock.module('../family.ts', () => ({ asFamily, asUser, withFamily }));
mock.module('../storage.ts', () => ({
	fileResponse: async (familyId: string, _area: string, name: string) =>
		new Response(`${familyId}/${name}`)
}));
// As own-music.ts' own: the track or the album, looked for inside the family.
mock.module('../own-music.ts', () => ({
	trackAddress: (familyId: string, id: number) =>
		asFamily(familyId, async (tx) => {
			const [t] = await tx.select().from(ownTrack).where(eq(ownTrack.id, id));
			return t ? `https://bucket.test/${t.key}?firma` : null;
		}),
	coverOf: (familyId: string, id: number) =>
		asFamily(familyId, async (tx) => {
			const [a] = await tx.select().from(ownAlbum).where(eq(ownAlbum.id, id));
			if (!a) return null;
			return a.coverKey
				? { url: `https://bucket.test/${a.coverKey}?firma` }
				: a.coverFile
					? { file: a.coverFile, area: 'musica', type: 'image/jpeg' }
					: null;
		})
}));

const { appPasswords } = await import('./auth.ts');
const { attempts, MAX_PER_ACCOUNT, MAX_PER_ADDRESS, WINDOW_MS } = await import('./attempts.ts');
const { methodOf, libraryOf } = await import('./methods.ts');

const plain = {
	encrypt: (text: string) => `cerrado:${text}`,
	decrypt: (value: string) => value.replace('cerrado:', '')
};
const apps = appPasswords({
	db,
	withFamily,
	asUser,
	secrets: userSecrets({ asUser, kms: null, plain })
});

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@Test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const login = (email: string, password: string) =>
	new URLSearchParams({
		u: email,
		s: 'sal',
		t: createHash('md5')
			.update(password + 'sal')
			.digest('hex')
	});

/** The ids of A's and B's only album and tracks. */
const own: Record<string, { album: number; tracks: number[] }> = {};

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(user).values(['ana', 'nene', 'bea', 'suelta', 'carla'].map(person));
	await db.insert(family).values(['A', 'B', 'C'].map((id) => ({ id, name: id })));
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' as const },
		{ userId: 'nene', familyId: 'A', role: 'peque' as const },
		{ userId: 'bea', familyId: 'B', role: 'member' as const },
		{ userId: 'carla', familyId: 'C', role: 'admin' as const }
	]);
	for (const familyId of ['A', 'B']) {
		await db.insert(musicSource).values({ familyId, bucket: 'x', label: 'x' });
		const [album] = await db
			.insert(ownAlbum)
			.values({
				familyId,
				title: `Disco ${familyId}`,
				artist: 'Queen',
				customTitle: familyId === 'A' ? 'Corregido' : null,
				year: 1975,
				coverKey: familyId === 'A' ? 'q/cover.jpg' : null,
				coverFile: familyId === 'B' ? 'b.jpg' : null
			})
			.returning();
		const tracks = await db
			.insert(ownTrack)
			.values(
				[2, 1].map((disc) => ({
					familyId,
					albumId: album!.id,
					key: `q/${familyId}-${disc}.M4A`,
					etag: 'e',
					size: 1000,
					title: `Canción ${familyId}${disc}`,
					artist: 'Queen',
					disc,
					number: 1,
					durationSec: 100,
					mime: 'audio/mp4; codecs="alac"'
				}))
			)
			.returning();
		own[familyId] = { album: album!.id, tracks: tracks.map((t) => t.id) };
	}
});

const ana = { id: 'ana', name: 'ana', email: 'ana@Test.es', familyId: 'A' };
const call = (name: string, params: Record<string, string> = {}, who: object = ana) =>
	methodOf(name)!(
		new URLSearchParams(params),
		new Request('https://seilide.test/rest/x'),
		who as typeof ana
	);
const answer = async (...args: Parameters<typeof call>) =>
	(await (await call(...args)).json())['subsonic-response'];

describe('getting in', () => {
	test('with the password for apps, whatever the case of the email; not with another', async () => {
		const password = (await apps.make('ana'))!;
		expect(password).toMatch(/^([a-z2-9]{5}-){3}[a-z2-9]{5}$/);
		expect(await apps.userOf(login('ANA@test.es', password))).toMatchObject({
			id: 'ana',
			familyId: 'A'
		});
		expect(await apps.userOf(login('ana@test.es', 'otra'))).toBeNull();
		expect(await apps.userOf(login('nadie@test.es', password))).toBeNull();
		expect(await apps.userOf(login('bea@test.es', password))).toBeNull();
		expect(await apps.userOf(new URLSearchParams({ u: 'ana@test.es' }))).toBeNull();
		expect(await apps.since('ana')).toBeInstanceOf(Date);
		expect(await apps.since('bea')).toBeNull();
	});

	test('kept sealed, never as it is', async () => {
		const password = (await apps.make('ana'))!;
		const rows = await db.select().from(schema.userSecret);
		expect(rows.map((r) => r.value)).toEqual([`cerrado:${password}`]);
	});

	test('a new one leaves the old one out; taken away, nobody gets in', async () => {
		const first = (await apps.make('ana'))!;
		const second = (await apps.make('ana'))!;
		expect(await apps.userOf(login('ana@test.es', first))).toBeNull();
		expect(await apps.userOf(login('ana@test.es', second))).not.toBeNull();
		await apps.revoke('ana');
		expect(await apps.userOf(login('ana@test.es', second))).toBeNull();
		expect(await apps.since('ana')).toBeNull();
	});

	test('not a child, nor someone without family; made a child later, not any more', async () => {
		expect(await apps.make('nene')).toBeNull();
		expect(await apps.make('suelta')).toBeNull();
		const password = (await apps.make('bea'))!;
		expect(await apps.userOf(login('bea@test.es', password))).not.toBeNull();
		await db.update(familyMember).set({ role: 'peque' }).where(eq(familyMember.userId, 'bea'));
		expect(await apps.userOf(login('bea@test.es', password))).toBeNull();
		await db.update(familyMember).set({ role: 'member' }).where(eq(familyMember.userId, 'bea'));
	});
});

describe('failed tries', () => {
	test('blocked by address and account, not the account elsewhere; after a while, again', () => {
		let now = 0;
		const t = attempts(() => now);
		for (let i = 0; i < MAX_PER_ACCOUNT; i++) t.failed('1.1.1.1', 'ana');
		expect(t.blocked('1.1.1.1', 'ana')).toBe(true);
		expect(t.blocked('1.1.1.1', 'bea')).toBe(false);
		expect(t.blocked('2.2.2.2', 'ana')).toBe(false);
		now = WINDOW_MS;
		expect(t.blocked('1.1.1.1', 'ana')).toBe(false);
	});

	test('an address trying many accounts', () => {
		const t = attempts(() => 0);
		for (let i = 0; i < MAX_PER_ADDRESS; i++) t.failed('1.1.1.1', `n${i}`);
		expect(t.blocked('1.1.1.1', 'ana')).toBe(true);
		expect(t.blocked('2.2.2.2', 'ana')).toBe(false);
	});
});

describe('the library', () => {
	test("ids of Seilide's own, the family's names, discs in order", async () => {
		const { album } = await answer('getAlbum', { id: `s-al-${own.A!.album}` });
		expect(album).toMatchObject({ name: 'Corregido', artist: 'Queen', year: 1975, songCount: 2 });
		expect(album.song.map((s: { title: string }) => s.title)).toEqual(['Canción A1', 'Canción A2']);
		expect(album.song[0]).toMatchObject({
			discNumber: 1,
			contentType: 'audio/mp4',
			suffix: 'm4a',
			albumId: `s-al-${own.A!.album}`
		});
		expect(album.song[0].id).toMatch(/^s-tr-\d+$/);
		// The house's ids, or with nothing before them, are not ours.
		expect((await answer('getAlbum', { id: `al-${own.A!.album}` })).status).toBe('failed');
	});

	test("only the family's: browsing, searching and lists of albums", async () => {
		const texts = await Promise.all(
			[
				['getArtists', {}],
				['getAlbumList2', { type: 'newest' }],
				['getRandomSongs', { size: '50' }],
				['search3', { query: '' }],
				['search2', { query: 'disco' }]
			].map(async ([name, params]) =>
				JSON.stringify(await answer(name as string, params as Record<string, string>))
			)
		);
		expect(texts[3]).toContain('Canción A1');
		for (const text of texts) expect(text).not.toMatch(/Disco B|Canción B/);
	});

	test("another family's ids: no album, no song, no audio, no cover", async () => {
		const b = own.B!;
		expect((await answer('getAlbum', { id: `s-al-${b.album}` })).status).toBe('failed');
		expect((await answer('getSong', { id: `s-tr-${b.tracks[0]}` })).status).toBe('failed');
		expect((await answer('getMusicDirectory', { id: `s-al-${b.album}` })).status).toBe('failed');
		for (const name of ['stream', 'download'])
			expect((await call(name, { id: `s-tr-${b.tracks[0]}` })).status).toBe(404);
		expect((await call('getCoverArt', { id: `s-al-${b.album}` })).status).toBe(404);
		expect((await call('getCoverArt', { id: `s-tr-${b.tracks[0]}` })).status).toBe(404);
	});

	test('listening: to the bucket, by an address that is not kept; whatever format is asked', async () => {
		for (const name of ['stream', 'download']) {
			const r = await call(name, {
				id: `s-tr-${own.A!.tracks[0]}`,
				format: 'mp3',
				maxBitRate: '96'
			});
			expect(r.status).toBe(302);
			expect(r.headers.get('location')).toBe('https://bucket.test/q/A-2.M4A?firma');
			expect(r.headers.get('cache-control')).toBe('no-store');
		}
		expect((await call('stream', { id: 's-tr-999' })).status).toBe(404);
		expect((await call('stream', {})).status).toBe(404);
	});

	test("covers: the bucket's, or the one in the family's storage, also by a track", async () => {
		const r = await call('getCoverArt', { id: `s-tr-${own.A!.tracks[0]}` });
		expect(r.headers.get('location')).toBe('https://bucket.test/q/cover.jpg?firma');
		const bea = { ...ana, id: 'bea', familyId: 'B' };
		const kept = await call('getCoverArt', { id: `s-al-${own.B!.album}` }, bea);
		expect(await kept.text()).toBe('B/b.jpg');
	});

	test('without a bucket, none; what is not a method, nothing', async () => {
		expect(await libraryOf('C')).toBeNull();
		for (const name of ['constructor', 'toString', 'star', 'createPlaylist', 'nada'])
			expect(methodOf(name)).toBeUndefined();
	});
});
