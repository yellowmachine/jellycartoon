import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, musicSource, ownAlbum, ownTrack } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';

/**
 * «Tu música» (#534): a family sees only its own bucket, albums and tracks, as the app's role. The
 * track and cover addresses (own-music.ts) look them up this way: another family's id is not found
 * (404).
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
});

const add = (familyId: string, key: string) =>
	asFamily(familyId, async (tx) => {
		await tx
			.insert(musicSource)
			.values({ familyId, bucket: 'sellado', label: familyId })
			.onConflictDoNothing();
		const [album] = await tx
			.insert(ownAlbum)
			.values({ familyId, title: 'Disco', artist: 'Grupo' })
			.returning({ id: ownAlbum.id });
		const [track] = await tx
			.insert(ownTrack)
			.values({
				familyId,
				albumId: album!.id,
				key,
				etag: 'e',
				size: 1,
				title: 'Una',
				artist: 'Grupo',
				mime: 'audio/mpeg'
			})
			.returning({ id: ownTrack.id });
		return { album: album!.id, track: track!.id };
	});

describe('each family, its own', () => {
	test('another family’s track, album and bucket are not found', async () => {
		const a = await add('A', 'a.mp3');
		const b = await add('B', 'b.mp3');
		const trackOf = (familyId: string, id: number) =>
			asFamily(familyId, (tx) => tx.select().from(ownTrack).where(eq(ownTrack.id, id)));
		expect(await trackOf('A', a.track)).toHaveLength(1);
		expect(await trackOf('A', b.track)).toHaveLength(0);
		expect(
			await asFamily('A', (tx) => tx.select().from(ownAlbum).where(eq(ownAlbum.id, b.album)))
		).toHaveLength(0);
		expect(
			(await asFamily('B', (tx) => tx.select().from(musicSource))).map((s) => s.label)
		).toEqual(['B']);
	});

	test('nor written in another family’s name', async () => {
		await expect(
			asFamily('A', (tx) =>
				tx.insert(ownAlbum).values({ familyId: 'B', title: 'Ajeno', artist: 'Nadie' })
			)
		).rejects.toThrow();
	});
});
