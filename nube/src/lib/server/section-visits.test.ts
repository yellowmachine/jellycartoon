import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { sectionVisit, user } from './db/schema.ts';
import { userScope } from './family-scope.ts';
import { sectionVisits, VISIT_GAP_MS } from './section-visits-scope.ts';
import { sectionOfPath } from '../nav.ts';

/**
 * /admin's «Qué usa» on a real Postgres (PGlite) as the app's role: a visit counted once every half
 * hour, the last week summed up for the administrator only, and the old ones forgotten.
 */
const db = drizzle(new PGlite(), { schema });
const asUser = userScope(db, { role: 'app_user' });
let now = Date.parse('2026-11-14T10:00:00Z');
let day = '2026-11-14';
const visits = sectionVisits(
	db,
	{ asUser, today: () => day, now: () => now },
	{ role: 'app_user' }
);

const person = (id: string) => ({
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
	await db.insert(user).values(['ana', 'luis'].map(person));
});

describe('secciones', () => {
	test('a page’s section: the bar’s, its other paths, the home page; not a shared link', () => {
		expect(sectionOfPath('/gastos/banco')).toEqual({ path: '/gastos', label: 'Dinero' });
		expect(sectionOfPath('/carretera')).toEqual({ path: '/viajes', label: 'Viajes' });
		expect(sectionOfPath('/')).toEqual({ path: '/', label: 'Inicio' });
		expect(sectionOfPath('/ajustes')).toEqual({ path: '/ajustes', label: 'Ajustes' });
		expect(sectionOfPath('/s/abc')).toBeNull();
		expect(sectionOfPath('/invitacion/x')).toBeNull();
	});
});

describe('qué usa', () => {
	test('once every half hour for each person and section', async () => {
		expect(await visits.record('ana', '/musica')).toBe(true);
		now += 5 * 60_000;
		expect(await visits.record('ana', '/musica')).toBe(false);
		expect(await visits.record('ana', '/nevera')).toBe(true);
		expect(await visits.record('luis', '/musica')).toBe(true);
		now += VISIT_GAP_MS;
		expect(await visits.record('ana', '/musica')).toBe(true);
		expect((await visits.mine('ana')).find((r) => r.section === '/musica')!.visits).toBe(2);
	});

	test('the last week, summed up by person and section, for the administrator', async () => {
		// Another day, still within the week; and one of over a week ago.
		day = '2026-11-10';
		now += VISIT_GAP_MS;
		await visits.record('ana', '/musica');
		await db
			.insert(sectionVisit)
			.values({ userId: 'ana', section: '/gastos', day: '2026-11-01', visits: 9 });
		day = '2026-11-14';
		const usage = await visits.usage();
		const of = (u: string, s: string) => usage.find((x) => x.userId === u && x.section === s);
		expect(of('ana', '/musica')!.visits).toBe(3);
		expect(of('ana', '/nevera')!.visits).toBe(1);
		expect(of('luis', '/musica')!.visits).toBe(1);
		expect(of('ana', '/gastos')).toBeUndefined();
		expect((await visits.lastVisits()).get('ana')).toBeInstanceOf(Date);
	});

	test('only theirs to each one; nothing to the app’s role without app.is_admin', async () => {
		expect((await visits.mine('luis')).map((r) => r.userId)).toEqual(['luis']);
		const seen = await db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_user`);
			return tx.select().from(sectionVisit);
		});
		expect(seen).toEqual([]);
	});

	test('those of over 90 days ago, forgotten', async () => {
		await db
			.insert(sectionVisit)
			.values({ userId: 'luis', section: '/agenda', day: '2026-08-01', visits: 4 });
		await visits.forgetOld();
		const left = await db.select().from(sectionVisit);
		expect(left.some((r) => r.day === '2026-08-01')).toBe(false);
		expect(left.some((r) => r.day === '2026-11-01')).toBe(true);
	});
});
