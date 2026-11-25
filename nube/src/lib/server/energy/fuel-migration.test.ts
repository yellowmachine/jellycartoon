import { expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/** Migration 0131 (#628): the starts and purchases of before, as spots and units. */
const all = `${import.meta.dir}/../../../../drizzle`;

test('each start, a unit until the next; from a purchase if there was one by then', async () => {
	const pg = new PGlite();
	const db = drizzle(pg);
	// As it was: the migrations until 0129.
	const before = mkdtempSync(join(tmpdir(), 'migraciones-'));
	cpSync(all, before, { recursive: true });
	const journal = JSON.parse(readFileSync(join(before, 'meta/_journal.json'), 'utf8'));
	journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 130);
	writeFileSync(join(before, 'meta/_journal.json'), JSON.stringify(journal));
	await migrate(db, { migrationsFolder: before });
	rmSync(before, { recursive: true });
	await pg.exec(`
		insert into family (id, name) values ('A', 'A');
		insert into fuel (id, family_id, kind, starts_on_buy, guess_days) values
			(1, 'A', 'pellet', false, 9), (2, 'A', 'butano', true, null);
		insert into fuel_event (id, family_id, fuel_id, kind, day, quantity) values
			(1, 'A', 1, 'empezada', '2026-10-01', 1),
			(2, 'A', 1, 'compra', '2026-10-05', 2),
			(3, 'A', 1, 'empezada', '2026-10-06', 1),
			(4, 'A', 1, 'empezada', '2026-10-06', 1),
			(5, 'A', 1, 'empezada', '2026-10-20', 1),
			(6, 'A', 1, 'empezada', '2026-11-01', 1);
	`);
	await migrate(db, { migrationsFolder: all });
	const { rows: spots } = await pg.query(
		'select fuel_id, name, heats, guess_days from fuel_spot order by fuel_id'
	);
	expect(spots).toEqual([
		{ fuel_id: 1, name: '', heats: true, guess_days: 9 },
		{ fuel_id: 2, name: '', heats: true, guess_days: null }
	]);
	const { rows } = await pg.query(
		'select started_on::text s, ended_on::text e, from_stock f, purchase_id p from fuel_unit order by 1'
	);
	expect(rows).toEqual([
		{ s: '2026-10-01', e: '2026-10-06', f: false, p: null },
		{ s: '2026-10-06', e: '2026-10-20', f: true, p: 2 },
		{ s: '2026-10-20', e: '2026-11-01', f: true, p: 2 },
		{ s: '2026-11-01', e: null, f: false, p: null }
	]);
}, 30_000);
