import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { episode, series, seriesTag, tag, user, watchProgress } from '#lib/server/db/schema.ts';

/**
 * «Seguir viendo»: a series tagged «+18» stays out of it. On a real Postgres (PGlite, in memory)
 * with the migrations as they are.
 */
const db = drizzle(new PGlite(), { schema });
mock.module('#lib/server/db/index.ts', () => ({ db }));
// Mocks last the whole run (Bun): with what playlist.test.ts and watching-together.test.ts need too.
mock.module('#lib/server/kids.ts', () => ({
	allowedSeries: () => undefined,
	isKidAccount: async () => true,
	KIDS_ROLE: 'infantil'
}));
const { continueWatching } = await import('./watching.ts');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
});

test('a series tagged «+18» is not in «Seguir viendo»', async () => {
	await db.insert(user).values({
		id: 'u',
		name: 'Ana',
		email: 'ana@casa',
		createdAt: new Date(),
		updatedAt: new Date()
	});
	const [cartoon, explicit] = await db
		.insert(series)
		.values([
			{ title: 'Bluey', folder: 'Bluey' },
			{ title: 'The Boys', folder: 'The Boys' }
		])
		.returning();
	const [adult, other] = await db
		.insert(tag)
		.values([{ name: '+18' }, { name: 'drama' }])
		.returning();
	await db.insert(seriesTag).values([
		{ seriesId: explicit.id, tagId: adult.id },
		{ seriesId: explicit.id, tagId: other.id },
		{ seriesId: cartoon.id, tagId: other.id }
	]);
	const episodes = await db
		.insert(episode)
		.values(
			[cartoon, explicit].map((s) => ({
				seriesId: s.id,
				season: 1,
				number: 1,
				title: s.title,
				sourcePath: `${s.title}/1x01.mkv`,
				sourceSize: 1,
				sourceMtime: new Date(),
				status: 'ready' as const
			}))
		)
		.returning();
	await db
		.insert(watchProgress)
		.values(episodes.map((e) => ({ userId: 'u', episodeId: e.id, positionSec: 60 })));

	expect((await continueWatching('u')).map((w) => w.seriesTitle)).toEqual(['Bluey']);
});
