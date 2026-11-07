import { randomUUID } from 'node:crypto';
import { asc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { plug, plugEnergy } from '../db/schema.ts';
import { asFamily, withFamily } from '../family.ts';
import { createHub, type Hub } from './hub.ts';
import { newPlugToken, plugKeyScope } from './plug-key-scope.ts';
import { SWITCH_ID } from './shelly.ts';
import { MAX_PLUG_NAME, PLUG_KINDS, type PlugKind, type PlugView } from '#lib/plugs.ts';

/**
 * Smart plugs (#396): the family's, in Enchufes. Each connects to Seilide by itself (hub.ts), with
 * the address it was given here.
 */

/** The family's days, as fridge.ts's. */
const TIME_ZONE = process.env.TZ || 'Europe/Madrid';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });

/** Where server.js and the Vite plugin find the hub: one per process, kept across reloads (dev). */
export const HUB_KEY = Symbol.for('seilide.enchufes');

const plugOfToken = plugKeyScope(db);

function makeHub() {
	return createHub({
		plugOfToken,
		async save(familyId, plugId, patch) {
			const set: Partial<typeof plug.$inferInsert> = { lastSeenAt: new Date() };
			if (patch.output !== undefined) set.output = patch.output;
			if (patch.power !== undefined) set.power = patch.power;
			if (patch.energyWh !== undefined) set.energyWh = patch.energyWh;
			if (patch.deviceId) set.deviceId = patch.deviceId;
			if (patch.model) set.model = patch.model;
			await asFamily(familyId, (tx) => tx.update(plug).set(set).where(eq(plug.id, plugId)));
		},
		async addEnergy(familyId, plugId, hour, wh) {
			await asFamily(familyId, (tx) =>
				tx
					.insert(plugEnergy)
					.values({ plugId, familyId, hour, wh })
					.onConflictDoUpdate({
						target: [plugEnergy.plugId, plugEnergy.hour],
						set: { wh: sql`${plugEnergy.wh} + excluded.wh` }
					})
			);
		}
	});
}

const globals = globalThis as unknown as Record<symbol, Hub | undefined>;
export const hub: Hub = (globals[HUB_KEY] ??= makeHub());

/** Dead connections dropped now and then: one timer per process. */
const PINGING = Symbol.for('seilide.enchufes.ping');
const flags = globalThis as unknown as Record<symbol, boolean | undefined>;
if (!flags[PINGING]) {
	flags[PINGING] = true;
	setInterval(() => globals[HUB_KEY]?.checkAlive(), 30_000).unref?.();
}

/** The family's plugs, with what they used today and this month (the family's days). */
export function listPlugs(userId: string): Promise<PlugView[]> {
	const today = dayFormat.format(new Date());
	const localDay = sql`((${plugEnergy.hour} at time zone 'UTC') at time zone ${TIME_ZONE})::date`;
	return withFamily(userId, async (tx) => {
		const plugs = await tx
			.select({
				id: plug.id,
				name: plug.name,
				kind: plug.kind,
				output: plug.output,
				deviceId: plug.deviceId,
				model: plug.model,
				lastSeenAt: plug.lastSeenAt
			})
			.from(plug)
			.orderBy(asc(plug.createdAt));
		// A month at most is 31 days, plus a day for the time zone.
		const since = new Date(Date.now() - 32 * 86_400_000);
		const used = await tx
			.select({
				plugId: plugEnergy.plugId,
				today: sql<number>`coalesce(sum(${plugEnergy.wh}) filter (where ${localDay} = ${today}::date), 0)`,
				month: sql<number>`coalesce(sum(${plugEnergy.wh}) filter (where date_trunc('month', ${localDay}) = date_trunc('month', ${today}::date)), 0)`
			})
			.from(plugEnergy)
			.where(gte(plugEnergy.hour, since))
			.groupBy(plugEnergy.plugId);
		const byPlug = new Map(used.map((u) => [u.plugId, u]));
		return plugs.map((p) => {
			const now = hub.liveOf(p.id);
			return {
				id: p.id,
				name: p.name,
				kind: p.kind,
				online: now.online,
				waiting: p.lastSeenAt === null && !now.online,
				output: now.online ? now.output : p.output,
				power: now.online ? now.power : null,
				todayWh: Number(byPlug.get(p.id)?.today ?? 0),
				monthWh: Number(byPlug.get(p.id)?.month ?? 0),
				lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
				model: p.model
			};
		});
	});
}

const cleanName = (name: string, kind: PlugKind) =>
	name.trim().slice(0, MAX_PLUG_NAME) || PLUG_KINDS[kind].label;

/** A new plug: its token, shown once inside its address. Found by a satellite, its Shelly's id. */
export async function createPlug(
	userId: string,
	name: string,
	kind: PlugKind,
	deviceId: string | null = null
) {
	const made = newPlugToken();
	const id = randomUUID();
	await withFamily(userId, (tx, { familyId }) =>
		tx
			.insert(plug)
			.values({ id, familyId, name: cleanName(name, kind), kind, hash: made.hash, deviceId })
	);
	return { id, token: made.token };
}

/** A new address for it, the old one no longer valid (lost, or set on another plug). */
export async function renewPlugToken(userId: string, id: string) {
	const made = newPlugToken();
	const [row] = await withFamily(userId, (tx) =>
		tx.update(plug).set({ hash: made.hash }).where(eq(plug.id, id)).returning({ id: plug.id })
	);
	if (!row) return null;
	await hub.remove(id);
	return made.token;
}

export async function updatePlug(userId: string, id: string, name: string, kind: PlugKind) {
	await withFamily(userId, (tx) =>
		tx
			.update(plug)
			.set({ name: cleanName(name, kind), kind })
			.where(eq(plug.id, id))
	);
}

/** Whether this plug is the family's: only then is it sent orders. */
async function isFamilys(userId: string, id: string) {
	const [row] = await withFamily(userId, (tx) =>
		tx.select({ id: plug.id }).from(plug).where(eq(plug.id, id))
	);
	return Boolean(row);
}

export async function deletePlug(userId: string, id: string) {
	if (!(await isFamilys(userId, id))) return;
	await hub.remove(id);
	await withFamily(userId, (tx) => tx.delete(plug).where(eq(plug.id, id)));
}

/** On or off: false if it is not the family's. Throws PlugOffline if it is not connected. */
export async function switchPlug(userId: string, id: string, on: boolean) {
	if (!(await isFamilys(userId, id))) return false;
	await hub.call(id, 'Switch.Set', { id: SWITCH_ID, on });
	return true;
}

/** The family, told when any of its plugs changes. */
export const watchPlugs = (familyId: string, listener: () => void) => hub.watch(familyId, listener);
