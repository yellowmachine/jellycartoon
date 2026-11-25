import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { plugEnergy } from '../db/schema.ts';
import type { AnyDb } from '../family-scope.ts';
import { hourOf, MAX_HOUR_WH } from './shelly.ts';

/**
 * Enchufes → Consumo: the hours that are wrong. What no plug can use in an hour is taken out by
 * itself («sin dato», 0 in every sum); any other, by hand. As it came is kept, to put it back.
 * Only hours already over: the one going on still grows.
 */

/** Those impossible, taken out; those someone said are right, not again. How many. */
export async function takeOutImpossible(tx: AnyDb, now = new Date()) {
	const done = await tx
		.update(plugEnergy)
		.set({ rawWh: plugEnergy.wh, wh: 0, mark: 'sin_dato' })
		.where(
			and(gt(plugEnergy.wh, MAX_HOUR_WH), isNull(plugEnergy.mark), lt(plugEnergy.hour, hourOf(now)))
		)
		.returning({ hour: plugEnergy.hour });
	return done.length;
}

/** «Sin dato», another value, or as it came. */
export type HourFix = { to: 'sin_dato' } | { to: 'valor'; wh: number } | { to: 'original' };

/** False if that hour is not there, or is not over. */
export async function fixHour(
	tx: AnyDb,
	plugId: string,
	hour: Date,
	fix: HourFix,
	now = new Date()
) {
	const where = and(
		eq(plugEnergy.plugId, plugId),
		eq(plugEnergy.hour, hour),
		lt(plugEnergy.hour, hourOf(now))
	);
	const [row] = await tx.select().from(plugEnergy).where(where).for('update');
	if (!row) return false;
	const raw = row.rawWh ?? row.wh;
	await tx
		.update(plugEnergy)
		.set(
			fix.to === 'original'
				? // Right, though it looks impossible: not taken out again.
					{ wh: raw, rawWh: null, mark: raw > MAX_HOUR_WH ? 'confirmado' : null }
				: fix.to === 'sin_dato'
					? { wh: 0, rawWh: raw, mark: 'sin_dato' }
					: { wh: fix.wh, rawWh: raw, mark: 'corregido' }
		)
		.where(where);
	return true;
}
