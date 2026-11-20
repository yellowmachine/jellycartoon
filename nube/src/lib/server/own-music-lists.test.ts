import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, musicSource, ownAlbum, ownTrack } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';

/**
 * A list of «Tu música» with its songs dragged into place, on a real Postgres (PGlite) as the
 * app's role: before another one, to the end, and not in another family's list.
 */
const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
mock.module('#lib/server/family.ts', () => ({ asFamily }));

const { createOwnPlaylist, moveInOwnPlaylistBefore, ownPlaylistOf } =
	await import('./own-music-lists.ts');

let trackIds: number[] = [];

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
	trackIds = await asFamily('A', async (tx) => {
		await tx.insert(musicSource).values({ familyId: 'A', bucket: 'b', label: 'A' });
		const [album] = await tx
			.insert(ownAlbum)
			.values({ familyId: 'A', title: 'Disco', artist: 'Grupo' })
			.returning({ id: ownAlbum.id });
		const rows = await tx
			.insert(ownTrack)
			.values(
				['Una', 'Dos', 'Tres', 'Cuatro'].map((title) => ({
					familyId: 'A',
					albumId: album!.id,
					key: `${title}.mp3`,
					etag: 'e',
					size: 1,
					title,
					artist: 'Grupo',
					mime: 'audio/mpeg'
				}))
			)
			.returning({ id: ownTrack.id });
		return rows.map((r) => r.id);
	});
});

const titles = async (familyId: string, id: number) =>
	(await ownPlaylistOf(familyId, id))!.items.map((i) => i.track.title);
const itemIds = async (id: number) => (await ownPlaylistOf('A', id))!.items.map((i) => i.itemId);

describe('dragged into place', () => {
	test('before another one, and to the end', async () => {
		const id = await createOwnPlaylist('A', 'Para correr', trackIds);
		const [una, , tres, cuatro] = await itemIds(id);
		await moveInOwnPlaylistBefore('A', id, cuatro!, una!);
		expect(await titles('A', id)).toEqual(['Cuatro', 'Una', 'Dos', 'Tres']);
		await moveInOwnPlaylistBefore('A', id, cuatro!, null);
		expect(await titles('A', id)).toEqual(['Una', 'Dos', 'Tres', 'Cuatro']);
		await moveInOwnPlaylistBefore('A', id, una!, cuatro!);
		await moveInOwnPlaylistBefore('A', id, tres!, una!);
		expect(await titles('A', id)).toEqual(['Dos', 'Tres', 'Una', 'Cuatro']);
	});

	test('another family cannot move a list that is not theirs', async () => {
		const id = await createOwnPlaylist('A', 'Ajena', trackIds);
		const [una, , , cuatro] = await itemIds(id);
		await moveInOwnPlaylistBefore('B', id, cuatro!, una!);
		expect(await titles('A', id)).toEqual(['Una', 'Dos', 'Tres', 'Cuatro']);
	});
});
