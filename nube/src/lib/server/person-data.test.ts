import { describe, expect, test } from 'bun:test';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './db/schema.ts';
import { user } from './db/schema.ts';
import { PERSON_DATA } from './person-data.ts';

const tables = (Object.values(schema) as unknown[])
	.filter((value): value is PgTable => is(value, PgTable))
	.map((table) => getTableConfig(table));

/** Of a family, or of a person: what leaving has to answer for. */
const answerable = tables
	.filter(
		(t) =>
			t.columns.some((c) => c.name === 'family_id') ||
			t.foreignKeys.some((fk) => fk.reference().foreignTable === user)
	)
	.map((t) => t.name)
	.sort();

/** What goes, wholly or in part, to the new family. */
const leaves = new Set(['moves', 'onlyTheirsOrCopy', 'onlyTheirsOrStays', 'copies']);

describe('what leaving does to each table (#315)', () => {
	test('every table of a family or of a person is on the list', () => {
		expect(answerable.filter((name) => !(name in PERSON_DATA))).toEqual([]);
	});

	test('nothing on the list is gone from the schema', () => {
		expect(Object.keys(PERSON_DATA).filter((name) => !answerable.includes(name))).toEqual([]);
	});

	test('nothing that leaves is tied by its family to something that stays', () => {
		const tied = tables.flatMap((t) => {
			if (!leaves.has(PERSON_DATA[t.name]?.leaving)) return [];
			return t.foreignKeys.flatMap((fk) => {
				const { columns, foreignTable } = fk.reference();
				const target = getTableConfig(foreignTable).name;
				const bound = columns.length > 1 && columns.some((c) => c.name === 'family_id');
				return bound && PERSON_DATA[target]?.leaving === 'stays' ? [`${t.name} → ${target}`] : [];
			});
		});
		expect(tied).toEqual([]);
	});
});
