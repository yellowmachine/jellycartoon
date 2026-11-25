import { beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { bodyWeight, user } from '../db/schema.ts';
import { userScope } from '../family-scope.ts';
import { weightScope } from './weight-scope.ts';

/** A person's weight on a real Postgres (PGlite), as the app's role: only theirs. */
const db = drizzle(new PGlite(), { schema });
const weight = weightScope(db, { role: 'app_user' });

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	const at = new Date();
	await db.insert(user).values(
		['ana', 'luis'].map((id) => ({
			id,
			name: id,
			email: `${id}@test.es`,
			createdAt: at,
			updatedAt: at
		}))
	);
});

test('by day, the last of each; only one’s own, also without asking by person', async () => {
	await weight.save('ana', { day: '2026-11-25', kg: 70 });
	await weight.save('ana', { day: '2026-11-25', kg: 70.3 });
	await weight.save('ana', { day: '2026-10-01', kg: 71 });
	await weight.save('luis', { day: '2026-11-25', kg: 90 });
	expect(await weight.list('ana')).toEqual([
		{ day: '2026-10-01', kg: 71 },
		{ day: '2026-11-25', kg: 70.3 }
	]);
	const seen = await userScope(db, { role: 'app_user' })('luis', (tx) =>
		tx.select().from(bodyWeight)
	);
	expect(seen.map((w) => w.userId)).toEqual(['luis']);
	await weight.remove('luis', '2026-10-01');
	await weight.remove('ana', '2026-11-25');
	expect(await weight.list('ana')).toEqual([{ day: '2026-10-01', kg: 71 }]);
});
