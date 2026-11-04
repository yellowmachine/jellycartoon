import { and, eq, type SQL } from 'drizzle-orm';
import type { PgDatabase, PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { replicaState, seriesTag, tag } from '#lib/server/db/schema.ts';

/**
 * Aplicar en la casa lo que baja de Seilide por Electric (#394): sin red ni temporizadores, para
 * probarlo en un Postgres de verdad (replica.ts lo pone a andar). Cada tanda, con la posición, en
 * una sola transacción: al volver, se sigue donde quedó, sin perder ni repetir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, any, any>;
type Row = Record<string, unknown>;

export interface Change {
	operation: 'insert' | 'update' | 'delete';
	value: Row;
}

export interface Position {
	handle: string;
	offset: string;
}

interface Replica {
	table: PgTable;
	/** Lo que forma su clave, en Electric y en la tabla. */
	key: Record<string, PgColumn>;
	/** El resto de columnas. */
	rest: Record<string, PgColumn>;
}

/** Sin `family_id`: en la casa solo hay una familia. */
export const REPLICAS = {
	tag: { table: tag, key: { id: tag.id }, rest: { name: tag.name } },
	series_tag: {
		table: seriesTag,
		key: { series_id: seriesTag.seriesId, tag_id: seriesTag.tagId },
		rest: {}
	}
} satisfies Record<string, Replica>;

export type ReplicaName = keyof typeof REPLICAS;

const columnKey = (replica: Replica, column: PgColumn) =>
	Object.entries(replica.table).find(([, c]) => c === column)?.[0] as string;

/** La fila, con los nombres de la tabla en Drizzle, solo con las columnas que trae. */
function toRow(replica: Replica, value: Row) {
	const row: Row = {};
	for (const [name, column] of Object.entries({ ...replica.key, ...replica.rest }))
		if (name in value) row[columnKey(replica, column)] = value[name];
	return row;
}

const whereKey = (replica: Replica, value: Row): SQL =>
	and(...Object.entries(replica.key).map(([name, column]) => eq(column, value[name]))) as SQL;

export const rowKey = (name: ReplicaName, value: Row) =>
	Object.keys(REPLICAS[name].key)
		.map((k) => String(value[k]))
		.join('/');

async function upsert(tx: AnyDb, replica: Replica, value: Row) {
	const row = toRow(replica, value);
	const set = toRow(
		replica,
		Object.fromEntries(Object.keys(replica.rest).map((k) => [k, value[k]]))
	);
	const insert = tx.insert(replica.table).values(row);
	await (Object.keys(set).length
		? insert.onConflictDoUpdate({ target: Object.values(replica.key), set })
		: insert.onConflictDoNothing());
}

async function savePosition(tx: AnyDb, name: ReplicaName, { handle, offset }: Position) {
	const updatedAt = new Date();
	await tx
		.insert(replicaState)
		.values({ shape: name, handle, offset, updatedAt })
		.onConflictDoUpdate({ target: replicaState.shape, set: { handle, offset, updatedAt } });
}

export async function readPosition(db: AnyDb, name: ReplicaName): Promise<Position | null> {
	const [row] = await db.select().from(replicaState).where(eq(replicaState.shape, name));
	return row ? { handle: row.handle, offset: row.offset } : null;
}

/** Una tanda de cambios, en orden. */
export async function applyChanges(
	db: AnyDb,
	name: ReplicaName,
	changes: Change[],
	position: Position
) {
	const replica: Replica = REPLICAS[name];
	await db.transaction(async (tx) => {
		for (const { operation, value } of changes) {
			if (operation === 'delete') {
				await tx.delete(replica.table).where(whereKey(replica, value));
			} else if (operation === 'insert') {
				await upsert(tx, replica, value);
			} else {
				const set = toRow(replica, value);
				for (const column of Object.values(replica.key)) delete set[columnKey(replica, column)];
				if (Object.keys(set).length)
					await tx.update(replica.table).set(set).where(whereKey(replica, value));
			}
		}
		await savePosition(tx, name, position);
	});
}

/**
 * La tabla entera, tras una carga desde cero, de golpe: nunca hay un momento sin etiquetas, que es
 * lo que decide lo que ve un peque. Comparando, no borrando todo: las películas y los accesos que
 * siguen en la casa apuntan a `tag` con borrado en cascada, y perderían las suyas.
 */
export async function replaceAll(db: AnyDb, name: ReplicaName, rows: Row[], position: Position) {
	const replica: Replica = REPLICAS[name];
	const wanted = new Set(rows.map((row) => rowKey(name, row)));
	await db.transaction(async (tx) => {
		const columns = Object.fromEntries(Object.entries(replica.key));
		const existing = (await tx.select(columns).from(replica.table)) as Row[];
		for (const row of existing)
			if (!wanted.has(rowKey(name, row)))
				await tx.delete(replica.table).where(whereKey(replica, row));
		for (const row of rows) await upsert(tx, replica, row);
		await savePosition(tx, name, position);
	});
}

/** Lo recibido durante una carga desde cero, hasta tenerla entera. */
export function foldChange(name: ReplicaName, rows: Map<string, Row>, change: Change) {
	const key = rowKey(name, change.value);
	if (change.operation === 'delete') rows.delete(key);
	else rows.set(key, { ...rows.get(key), ...change.value });
}
