import { eq, getTableColumns, inArray, is, or, type SQL } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '#lib/server/db/schema.ts';
import { familyPerson, user } from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import { openFileFor, openFor } from '#lib/server/family-secret.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { PERSON_DATA, type InZip, type ZipWhere } from '#lib/server/person-data.ts';
import { readFile } from '#lib/server/storage.ts';

/**
 * «Descargar mis datos» (#315): a person's data, as person-data.ts says, as a zip made while it is
 * downloaded, one file at a time. RGPD's portability: JSON to be read by a machine, their files as
 * they are. Their rows are read first, so a failure there is an error and not half a zip; a file
 * that cannot be read comes later, when the download has begun, and is said in FALTAN.txt.
 */

type Row = Record<string, unknown>;

const TABLES = new Map(
	(Object.values(schema) as unknown[])
		.filter((value): value is PgTable => is(value, PgTable))
		.map((table) => [getTableConfig(table).name, table])
);

const rowsOf = (rows: Map<string, Row[]>, table: string) => rows.get(table) ?? [];

/** The rows of a table for this person: of the tables it depends on, first. */
async function load(
	tx: AnyDb,
	name: string,
	zip: InZip,
	me: { userId: string; personId: number | null },
	rows: Map<string, Row[]>
) {
	if (rows.has(name)) return;
	const table = TABLES.get(name)!;
	const columns = getTableColumns(table);
	const conditions: SQL[] = [];
	for (const where of zip.where) {
		const condition = await conditionOf(tx, where, columns, me, rows);
		if (condition) conditions.push(condition);
	}
	const found = conditions.length
		? ((await tx
				.select()
				.from(table)
				.where(or(...conditions))) as Row[])
		: [];
	const hidden = zip.hiddenIf;
	rows.set(
		name,
		hidden ? found.filter((r) => !r[hidden.column] || r[hidden.notMine] === me.userId) : found
	);
}

async function conditionOf(
	tx: AnyDb,
	where: ZipWhere,
	columns: Record<string, Parameters<typeof eq>[0]>,
	me: { userId: string; personId: number | null },
	rows: Map<string, Row[]>
) {
	const column = columns[where.column];
	if ('is' in where) {
		if (where.is === 'me') return eq(column, me.userId);
		return me.personId === null ? null : eq(column, me.personId);
	}
	const parent = PERSON_DATA[where.among.table].zip;
	if (!parent) return null;
	await load(tx, where.among.table, parent, me, rows);
	const values = rowsOf(rows, where.among.table).map((r) => r[where.among.column]);
	return values.length ? inArray(column, values) : null;
}

export interface MyData {
	/** Its name, for the zip's: `seilide-mis-datos-2026-11-06.zip`. */
	day: string;
	account: Row | undefined;
	rows: Map<string, Row[]>;
}

/** All of this person's rows, at one moment. */
export async function readMyData(k: Kitchen, userId: string): Promise<MyData> {
	return k.run(async (tx) => {
		const [person] = await tx
			.select({ id: familyPerson.id })
			.from(familyPerson)
			.where(eq(familyPerson.userId, userId));
		const [account] = await tx
			.select({
				name: user.name,
				email: user.email,
				emailVerified: user.emailVerified,
				createdAt: user.createdAt
			})
			.from(user)
			.where(eq(user.id, userId));
		const rows = new Map<string, Row[]>();
		const me = { userId, personId: person?.id ?? null };
		for (const [name, { zip }] of Object.entries(PERSON_DATA))
			if (zip) await load(tx, name, zip, me, rows);
		return { day: new Date().toISOString().slice(0, 10), account, rows };
	});
}

const CANNOT_OPEN = '(no se pudo descifrar)';

const readMe = (day: string) => `Tus datos en Seilide, descargados el ${day}.

cuenta.json: tu nombre y tu correo.
datos/: lo tuyo y lo que escribiste en lo compartido de la familia, en JSON, un archivo por cada
tipo de cosa. Los identificadores que hay dentro (userId, familyId…) solo significan algo en Seilide.
archivos/: tus fotos, audios y documentos, tal como están. Los Papeles van descifrados: guarda este
zip con cuidado.
`;

const jsonOf = (value: unknown) => JSON.stringify(value, null, 2);

export interface ZipEntry {
	name: string;
	input: string | Uint8Array;
	lastModified: Date;
}

/** The zip's files, one at a time, each read only when its turn comes. */
export async function* myDataFiles(k: Kitchen, data: MyData): AsyncGenerator<ZipEntry> {
	const lastModified = new Date();
	const entry = (name: string, input: string | Uint8Array): ZipEntry => ({
		name,
		input,
		lastModified
	});
	const missing: string[] = [];

	yield entry('LEEME.txt', readMe(data.day));
	yield entry('cuenta.json', jsonOf(data.account));

	const zips = Object.entries(PERSON_DATA).flatMap(([table, { zip }]) =>
		zip ? [{ table, zip }] : []
	);
	for (const { table, zip } of zips) {
		const rows = rowsOf(data.rows, table);
		if (!rows.length) continue;
		const open = zip.sealed ?? [];
		const opened = open.length
			? await Promise.all(
					rows.map(async (row) => {
						const copy = { ...row };
						for (const column of open) {
							if (typeof copy[column] !== 'string') continue;
							copy[column] = await openFor(k.familyId, copy[column] as string).catch(() => {
								missing.push(`datos/${zip.file}.json: un dato de la fila ${String(row.id)}`);
								return CANNOT_OPEN;
							});
						}
						return copy;
					})
				)
			: rows;
		yield entry(`datos/${zip.file}.json`, jsonOf(opened));
	}

	for (const { table, zip } of zips) {
		const stored = zip.stored;
		if (!stored) continue;
		for (const row of rowsOf(data.rows, table)) {
			const value = row[stored.column];
			if (value === null || value === undefined) continue;
			// A receipt's name may have come with a path: only its last part is its name.
			const name = `${String(value).split('/').pop()}${stored.suffix ?? ''}`;
			const path = `archivos/${stored.area}/${name}`;
			const bytes = await readFile(k.familyId, stored.area, name).catch(() => null);
			const file =
				bytes && stored.sealed ? await openFileFor(k.familyId, bytes).catch(() => null) : bytes;
			if (file) yield entry(path, file);
			else missing.push(path);
		}
	}

	if (missing.length)
		yield entry(
			'FALTAN.txt',
			`Esto no se pudo incluir. Prueba a descargarlo otra vez:\n\n${missing.join('\n')}\n`
		);
}
