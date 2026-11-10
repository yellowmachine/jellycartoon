import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { listenTime, track, user } from '#lib/server/db/schema.ts';
import type { QueueSave } from 'comun/music.ts';
import { addListenTime } from './listen-time.ts';

/** Time listened to in the app's player (#421), on PGlite with the migrations as they are. */
const db = drizzle(new PGlite(), { schema });
const BBC = '598c4d0e-6b06-43fb-bff4-717c591213a9';

const queue = (over: Partial<QueueSave> = {}): QueueSave => ({
	trackIds: [1, 2],
	index: 0,
	positionSec: 0,
	shuffle: false,
	repeat: false,
	single: false,
	radio: null,
	podcast: null,
	changedBy: 'el móvil',
	...over
});
// In the server's time zone, as the slots are: 21:12 is in the 21:10 slot.
const at = (m: number, s: number) => new Date(2026, 10, 6, 21, m, s);
let source = 0;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.insert(user).values({
		id: 'ana',
		name: 'ana',
		email: 'ana@test.es',
		createdAt: new Date(),
		updatedAt: new Date()
	});
	const song = { size: 1, mtime: new Date(), status: 'ready' };
	await db.insert(track).values([
		{ id: 1, path: 'a.mp3', title: 'Mediterráneo', artist: 'Serrat', ...song },
		{ id: 2, path: 'b.mp3', title: 'raw', customTitle: 'Bonita', albumArtist: 'Varios', ...song }
	] as never);
});

beforeEach(async () => {
	await db.delete(listenTime);
	source++;
});

const rows = () => db.select().from(listenTime);

test('a song: what its position moved forward, with its title and artist', async () => {
	const tab = `tab${source}`;
	await addListenTime(db, 'ana', queue({ positionSec: 0 }), tab, true, at(12, 0));
	await addListenTime(db, 'ana', queue({ positionSec: 15 }), tab, true, at(12, 15));
	await addListenTime(db, 'ana', queue({ positionSec: 30 }), tab, true, at(12, 30));
	expect(await rows()).toMatchObject([
		{
			day: '2026-11-06',
			minute: 1270,
			item: 't1',
			kind: 'cancion',
			artist: 'Serrat',
			title: 'Mediterráneo',
			seconds: 30
		}
	]);
});

test('the next song starts from its first save; its own title and the album’s artist', async () => {
	const tab = `tab${source}`;
	await addListenTime(db, 'ana', queue({ index: 1, positionSec: 200 }), tab, true, at(12, 0));
	await addListenTime(db, 'ana', queue({ index: 1, positionSec: 2 }), tab, true, at(12, 15));
	await addListenTime(db, 'ana', queue({ index: 1, positionSec: 17 }), tab, true, at(12, 30));
	expect(await rows()).toMatchObject([
		{ item: 't2', artist: 'Varios', title: 'Bonita', seconds: 15 }
	]);
});

test('a station: by its name, without artist', async () => {
	const tab = `tab${source}`;
	const radio = (positionSec: number) => queue({ trackIds: [], radio: BBC, positionSec });
	await addListenTime(db, 'ana', radio(5), tab, true, at(12, 0));
	await addListenTime(db, 'ana', radio(20), tab, true, at(12, 15));
	expect(await rows()).toMatchObject([
		{ item: `r${BBC}`, kind: 'radio', artist: null, title: 'BBC World Service', seconds: 15 }
	]);
});

test('nothing for a podcast, a station not ours, or who does not keep history', async () => {
	const tab = `tab${source}`;
	for (const [q, keeps] of [
		[queue({ podcast: 9 }), true],
		[queue({ trackIds: [], radio: 'otra' }), true],
		[queue(), false]
	] as const) {
		await addListenTime(db, 'ana', { ...q, positionSec: 0 }, tab, keeps, at(12, 0));
		await addListenTime(db, 'ana', { ...q, positionSec: 15 }, tab, keeps, at(12, 15));
	}
	expect(await rows()).toEqual([]);
});
