import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gte, ne, sql } from 'drizzle-orm';
import { parseBillDetails } from 'comun/bills.ts';
import { db } from '../db/index.ts';
import {
	bill,
	expense,
	familySettings,
	plug,
	plugEnergy,
	plugReading,
	plugSchedule
} from '../db/schema.ts';
import { asFamily, withFamily } from '../family.ts';
import type { AnyDb } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';
import { satelliteKeyScope } from '../satellite-key-scope.ts';
import { createHub, PlugOffline, type Hub, type SignedOrder } from './hub.ts';
import { newPlugToken, plugKeyScope } from './plug-key-scope.ts';
import { isSensorDevice, SWITCH_ID } from './shelly.ts';
import {
	MAX_PLUG_NAME,
	noticeDefaults,
	PLUG_KINDS,
	type PlugKind,
	type PlugNotices,
	type PlugView
} from '#lib/plugs.ts';
import {
	checkSchedule,
	jobsFor,
	MAX_SCHEDULES,
	sameTimespec,
	type PlugJob,
	type PlugScheduleInput
} from '#lib/plug-schedules.ts';
import { billName, priceAt, priceFromBill, type KwhPrice } from '#lib/kwh-price.ts';

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
const satelliteOfKey = satelliteKeyScope(db);

/** Who watches the plugs for their notices (notices.ts, loaded by hooks.server.ts); none, no one. */
export interface PlugWatcher {
	load(familyId: string, plugId: string): void;
	live(familyId: string, plugId: string, power: number | null, output: boolean | null): void;
	gone(familyId: string, plugId: string): void;
	tick(): void;
	forget(plugId: string): void;
}
const WATCHER = Symbol.for('seilide.enchufes.avisos');
const watcherGlobals = globalThis as unknown as Record<symbol, PlugWatcher | undefined>;
export function setPlugWatcher(watcher: PlugWatcher) {
	watcherGlobals[WATCHER] = watcher;
}
const watcher = () => watcherGlobals[WATCHER];

function makeHub() {
	return createHub({
		plugOfToken,
		satelliteFamilyOf: async (key) => (await satelliteOfKey(key))?.familyId ?? null,
		async save(familyId, plugId, patch) {
			const set: Partial<typeof plug.$inferInsert> = { lastSeenAt: new Date() };
			if (patch.output !== undefined) set.output = patch.output;
			if (patch.power !== undefined) set.power = patch.power;
			if (patch.energyWh !== undefined) set.energyWh = patch.energyWh;
			if (patch.deviceId) set.deviceId = patch.deviceId;
			if (patch.model) set.model = patch.model;
			if (patch.ip) set.ip = patch.ip;
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
		},
		async addReading(familyId, plugId, at, reading) {
			const values = {
				tempC: reading.tempC ?? null,
				humidity: reading.humidity ?? null,
				battery: reading.battery ?? null,
				external: reading.external ?? null
			};
			await asFamily(familyId, async (tx) => {
				await tx
					.insert(plugReading)
					.values({ plugId, familyId, at, ...values })
					.onConflictDoUpdate({ target: [plugReading.plugId, plugReading.at], set: values });
				await tx.update(plug).set({ lastSeenAt: at }).where(eq(plug.id, plugId));
			});
			// Heard from: its «sin noticias» counts again from now.
			watcher()?.live(familyId, plugId, null, null);
		},
		onLive(familyId, plugId, live) {
			watcher()?.live(familyId, plugId, live.power, live.output);
		},
		onGone(familyId, plugId) {
			watcher()?.gone(familyId, plugId);
		},
		onConnect(familyId, plugId) {
			watcher()?.load(familyId, plugId);
			void syncPlug(familyId, plugId).catch((e) => {
				if (!(e instanceof PlugOffline)) console.error(`[enchufes] ${plugId}: sin sincronizar`, e);
			});
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
	setInterval(() => {
		globals[HUB_KEY]?.checkAlive();
		endHeats();
		crossSkips();
		watcher()?.tick();
	}, 30_000).unref?.();
}

/**
 * The family's plugs, with what they used today and this month (the family's days). Their address
 * in the wifi, only for who runs the family: its page lets anyone do anything to it.
 */
export const listPlugs = (userId: string) =>
	withFamily(userId, (tx, m) => readPlugs(tx, m.role === 'admin'));

/** The same, in a kitchen: a person's, or the house's (a satellite, the voice). */
export const plugsOf = (k: Kitchen) => k.run((tx) => readPlugs(tx, false));

async function readPlugs(tx: AnyDb, withIp: boolean): Promise<PlugView[]> {
	const today = dayFormat.format(new Date());
	const plugs = await tx
		.select({
			id: plug.id,
			name: plug.name,
			kind: plug.kind,
			output: plug.output,
			deviceId: plug.deviceId,
			model: plug.model,
			ip: plug.ip,
			lastSeenAt: plug.lastSeenAt,
			paused: plug.paused,
			locked: plug.locked,
			heatUntil: plug.heatUntil,
			skipFrom: plug.skipFrom,
			skipUntil: plug.skipUntil,
			notifyDone: plug.notifyDone,
			notifyStopped: plug.notifyStopped,
			notifyOffline: plug.notifyOffline,
			notifyOnHours: plug.notifyOnHours,
			notifyAloud: plug.notifyAloud
		})
		.from(plug)
		.orderBy(asc(plug.createdAt))
		// Sensors (#508) are no plugs: no switch, no energy.
		.then((rows) => rows.filter((p) => !isSensorDevice(p.deviceId)));
	const schedules = await tx
		.select({
			id: plugSchedule.id,
			plugId: plugSchedule.plugId,
			days: plugSchedule.days,
			start: plugSchedule.start,
			end: plugSchedule.end
		})
		.from(plugSchedule)
		.orderBy(asc(plugSchedule.start), asc(plugSchedule.id));
	// A month at most is 31 days, plus a day for the time zone. By the hour: each at its price.
	const since = new Date(Date.now() - 32 * 86_400_000);
	const month = today.slice(0, 7);
	const [hours, price] = await Promise.all([
		tx
			.select({ plugId: plugEnergy.plugId, hour: plugEnergy.hour, wh: plugEnergy.wh })
			.from(plugEnergy)
			.where(gte(plugEnergy.hour, since)),
		priceOf(tx)
	]);
	const byPlug = new Map<
		string,
		{ today: number; month: number; todayEur: number; monthEur: number }
	>();
	for (const h of hours) {
		const day = dayFormat.format(h.hour);
		if (day.slice(0, 7) !== month) continue;
		const sum = byPlug.get(h.plugId) ?? { today: 0, month: 0, todayEur: 0, monthEur: 0 };
		const euros = price ? (h.wh / 1000) * priceAt(price, h.hour) : 0;
		sum.month += h.wh;
		sum.monthEur += euros;
		if (day === today) {
			sum.today += h.wh;
			sum.todayEur += euros;
		}
		byPlug.set(h.plugId, sum);
	}
	return plugs.map((p) => {
		const now = hub.liveOf(p.id);
		return {
			id: p.id,
			name: p.name,
			kind: p.kind,
			online: now.online,
			relayed: now.online && now.relayed,
			satellite: now.online && now.relayed ? now.satellite : null,
			auto: now.online && now.relayed && now.auto,
			deviceId: p.deviceId,
			waiting: p.lastSeenAt === null && !now.online,
			reconnecting: !now.online && p.lastSeenAt !== null && hub.reconnecting(p.id),
			output: now.online ? now.output : p.output,
			power: now.online ? now.power : null,
			todayWh: byPlug.get(p.id)?.today ?? 0,
			monthWh: byPlug.get(p.id)?.month ?? 0,
			todayEuros: price ? (byPlug.get(p.id)?.todayEur ?? 0) : null,
			monthEuros: price ? (byPlug.get(p.id)?.monthEur ?? 0) : null,
			lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
			model: p.model,
			ip: withIp ? p.ip : null,
			paused: p.paused,
			locked: p.locked,
			notices: {
				done: p.notifyDone,
				stopped: p.notifyStopped,
				offline: p.notifyOffline,
				onHours: p.notifyOnHours,
				aloud: p.notifyAloud
			},
			heatUntil: p.heatUntil && p.heatUntil > new Date() ? p.heatUntil.toISOString() : null,
			...(p.skipFrom && p.skipUntil && p.skipUntil > new Date()
				? { skipFrom: p.skipFrom.toISOString(), skipUntil: p.skipUntil.toISOString() }
				: { skipFrom: null, skipUntil: null }),
			timerUntil:
				now.online && now.timerUntil && now.timerUntil > Date.now()
					? new Date(now.timerUntil).toISOString()
					: null,
			schedules: schedules
				.filter((x) => x.plugId === p.id)
				.map(({ id, days, start, end }) => ({ id, days, start, end }))
		};
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
	const familyId = await withFamily(userId, async (tx, { familyId }) => {
		await tx.insert(plug).values({
			id,
			familyId,
			name: cleanName(name, kind),
			kind,
			hash: made.hash,
			deviceId,
			...noticeDefaults(kind)
		});
		return familyId;
	});
	hub.changed(familyId);
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
	const [row] = await withFamily(userId, (tx, { familyId }) =>
		tx
			.update(plug)
			.set({ name: cleanName(name, kind), kind })
			.where(eq(plug.id, id))
			.returning({ familyId: sql<string>`${familyId}` })
	);
	if (!row) return;
	// Its notices say its name.
	watcher()?.load(row.familyId, id);
	hub.changed(row.familyId);
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
	const familyId = await withFamily(userId, async (tx, { familyId }) => {
		await tx.delete(plug).where(eq(plug.id, id));
		return familyId;
	});
	watcher()?.forget(id);
	hub.changed(familyId);
}

/**
 * On or off: false if it is not the family's, `locked` if it has its padlock, `paused` if it is
 * paused (it stays off), `heating` with `backAfterS` in a long heat (see switchIn). Throws
 * PlugOffline if it is not connected.
 */
export async function switchPlug(
	userId: string,
	id: string,
	on: boolean,
	backAfterS?: number,
	signed?: SignedOrder
) {
	return switchIn(await kitchenOfUser(userId), id, on, backAfterS, signed);
}

/**
 * What a device signed (#643), read to apply Seilide's own checks (padlock, pause): on or off, and
 * its timer. Null if it is not a Switch.Set of that plug. The satellite checks the signature.
 */
export function signedSwitch(order: SignedOrder, deviceId: string | null) {
	try {
		const e = JSON.parse(order.envelope) as {
			plug?: unknown;
			method?: unknown;
			params?: { on?: unknown; toggle_after?: unknown };
		};
		if (!deviceId || e.plug !== deviceId || e.method !== 'Switch.Set') return null;
		if (typeof e.params?.on !== 'boolean') return null;
		const after = e.params.toggle_after;
		return { on: e.params.on, backAfterS: typeof after === 'number' ? after : undefined };
	} catch {
		return null;
	}
}

/**
 * Whether Seilide may switch that plug by itself (#643), as a device signed it: its satellite keeps
 * it. False if it is not the family's.
 */
export async function permitPlug(userId: string, id: string, signed: SignedOrder) {
	const [row] = await withFamily(userId, (tx) =>
		tx.select({ id: plug.id, familyId: plug.familyId }).from(plug).where(eq(plug.id, id))
	);
	if (!row) return false;
	await hub.callSigned(id, signed);
	await hub.readGuard(id);
	// Allowed now: its schedules, which it may not have had.
	if (hub.liveOf(id).auto) await trySync(row.familyId, id);
	return true;
}

/** The same in a kitchen (the voice, a satellite's too). */
/**
 * On or off. With `backAfterS`, back the other way after those seconds: the plug's own timer
 * (Switch.Set's toggle_after), so it happens without Seilide; a schedule's job or another switch
 * before then cancels it, and a plug that loses power forgets it. Not in a long heat, whose timer it is.
 */
export async function switchIn(
	k: Pick<Kitchen, 'familyId' | 'run'>,
	id: string,
	on: boolean,
	backAfterS?: number,
	signed?: SignedOrder
) {
	const [row] = await k.run((tx) =>
		tx
			.select({
				paused: plug.paused,
				locked: plug.locked,
				heatUntil: plug.heatUntil,
				deviceId: plug.deviceId
			})
			.from(plug)
			.where(eq(plug.id, id))
	);
	if (!row) return false;
	if (row.locked) return 'locked' as const;
	if (row.paused) return 'paused' as const;
	const heating = row.heatUntil && row.heatUntil > new Date();
	if (backAfterS && heating) return 'heating' as const;
	if (signed) {
		// What it signed is what is done: it must say the same as what was asked.
		const said = signedSwitch(signed, row.deviceId);
		if (!said || said.on !== on || said.backAfterS !== backAfterS) return 'mismatch' as const;
		await hub.callSigned(id, signed);
	} else
		await hub.call(
			id,
			'Switch.Set',
			backAfterS ? { id: SWITCH_ID, on, toggle_after: backAfterS } : { id: SWITCH_ID, on }
		);
	// Started one, or ended the one it had: for its page.
	void hub.readTimer(id);
	// Switched off by hand in a long heat: the heat is over, its schedules back now.
	if (!on && heating) {
		await k.run((tx) => tx.update(plug).set({ heatUntil: null }).where(eq(plug.id, id)));
		heats.delete(id);
		await trySync(k.familyId, id);
	}
	return true;
}

/** A person's family, to run in it. */
async function kitchenOfUser(userId: string): Promise<Pick<Kitchen, 'familyId' | 'run'>> {
	const familyId = await withFamily(userId, async (_, m) => m.familyId);
	return { familyId, run: (fn) => withFamily(userId, (tx) => fn(tx)) };
}

/** The family, told when any of its plugs changes. */
export const watchPlugs = (familyId: string, listener: () => void) => hub.watch(familyId, listener);

/** The family's price of a kWh (kwh-price.ts): by hand, or its last light bill's; null, unknown. */
export async function kwhPrice(userId: string) {
	return kwhPriceIn(await kitchenOfUser(userId));
}

export const kwhPriceIn = (k: Pick<Kitchen, 'run'>) => k.run((tx) => priceOf(tx));

/** The one written by hand in Enchufes, which wins over the bill's; null, none. */
export async function manualKwhPrice(userId: string) {
	const [row] = await withFamily(userId, (tx) =>
		tx.select({ price: familySettings.kwhPrice }).from(familySettings)
	);
	return row?.price ?? null;
}

export async function priceOf(tx: AnyDb): Promise<KwhPrice | null> {
	const [own] = await tx.select({ price: familySettings.kwhPrice }).from(familySettings);
	if (own?.price)
		return { source: 'mano', pricing: 'fijo', flat: own.price, periods: null, from: null };
	// The last light bill that says its price.
	const bills = await tx
		.select({ details: bill.details, store: expense.store, periodEnd: bill.periodEnd })
		.from(bill)
		.innerJoin(expense, eq(expense.id, bill.expenseId))
		.where(eq(bill.kind, 'Luz'))
		.orderBy(desc(bill.periodEnd), desc(bill.id))
		.limit(3);
	for (const b of bills) {
		const price = priceFromBill(parseBillDetails(b.details), billName(b.store, b.periodEnd));
		if (price) return price;
	}
	return null;
}

/** At most this, to catch a typo: no tariff is near it. */
export const MAX_KWH_PRICE = 5;

export async function setKwhPrice(userId: string, price: number | null) {
	const familyId = await withFamily(userId, async (tx, { familyId }) => {
		await tx
			.insert(familySettings)
			.values({ familyId, kwhPrice: price })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { kwhPrice: price } });
		return familyId;
	});
	// Its euros, new in the pages open.
	hub.changed(familyId);
}

// Schedules, pause and the long heat (#396, phase 2).

/** A water heater paused this long, or this long without using anything, heats long on waking. */
export const LONG_PAUSE_MS = 7 * 86_400_000;
/** Less than this in that time is «nothing»: a water heater that heats uses kWh. */
const NOTHING_WH = 50;
/** How long that heat lasts, on without stopping. */
export const HEAT_MS = 4 * 3_600_000;

/** Heats going on now, by plug: when each ends, to put its schedules back then. */
const HEATS = Symbol.for('seilide.enchufes.calentar');
const heatGlobals = globalThis as unknown as Record<
	symbol,
	Map<string, { familyId: string; until: number }>
>;
const heats = (heatGlobals[HEATS] ??= new Map());

/**
 * Skips known (#557), by plug: when each starts and ends, and whether it was on at the last look; at
 * each edge the plug is synced, its «on» jobs off or back. Filled by `syncPlug` (on connecting too).
 */
const SKIPS = Symbol.for('seilide.enchufes.saltos');
const skipGlobals = globalThis as unknown as Record<
	symbol,
	Map<string, { familyId: string; from: number; until: number; inside: boolean }>
>;
const skips = (skipGlobals[SKIPS] ??= new Map());

function crossSkips() {
	const now = Date.now();
	for (const [plugId, s] of skips) {
		const inside = s.from <= now && now < s.until;
		if (inside === s.inside && now < s.until) continue;
		if (now >= s.until) skips.delete(plugId);
		else s.inside = inside;
		void syncPlug(s.familyId, plugId).catch(() => {});
	}
}

function endHeats() {
	const now = Date.now();
	for (const [plugId, heat] of heats)
		if (heat.until <= now) {
			heats.delete(plugId);
			void syncPlug(heat.familyId, plugId).catch(() => {});
		}
}

/** The jobs of the plug's own, as it lists them. */
interface ShellyJob {
	id: number;
	enable: boolean;
	timespec: string;
	calls?: { method?: string; params?: { on?: unknown } }[];
}

const sameJob = (job: ShellyJob, want: PlugJob) =>
	job.enable === want.enable &&
	sameTimespec(job.timespec, want.timespec) &&
	job.calls?.length === 1 &&
	job.calls[0]!.method === 'Switch.Set' &&
	job.calls[0]!.params?.on === want.on;

/** What Seilide keeps of a plug's schedules: its state, and the schedules. */
async function planOf(familyId: string, plugId: string) {
	return asFamily(familyId, async (tx) => ({
		row: (
			await tx
				.select({
					paused: plug.paused,
					heatUntil: plug.heatUntil,
					scheduleJobs: plug.scheduleJobs,
					deviceId: plug.deviceId,
					skipFrom: plug.skipFrom,
					skipUntil: plug.skipUntil
				})
				.from(plug)
				.where(eq(plug.id, plugId))
		)[0],
		schedules: await tx
			.select({ days: plugSchedule.days, start: plugSchedule.start, end: plugSchedule.end })
			.from(plugSchedule)
			.where(eq(plugSchedule.plugId, plugId))
			.orderBy(asc(plugSchedule.id))
	}));
}

/** What a device signs for its plug's schedules (#643): its satellite does it in one go. */
export interface ScheduleTarget {
	id: string;
	satellite: string;
	deviceId: string;
	params: { jobs: PlugJob[]; replace: number[]; off?: true; onFor?: number };
}

/**
 * After a schedule or a pause changed (#643): if the plug goes through a satellite that does not
 * let Seilide do it alone, what this device is to sign for it to be done now, as syncPlug would. Null
 * if Seilide does it itself, or there is nothing to sign for (not connected, a sensor).
 */
export async function scheduleTarget(familyId: string, plugId: string) {
	const live = hub.liveOf(plugId);
	if (!live.online || !live.relayed || live.auto || !live.satellite) return null;
	const { row, schedules } = await planOf(familyId, plugId);
	if (!row?.deviceId || isSensorDevice(row.deviceId)) return null;
	const now = Date.now();
	const heatLeft = row.heatUntil ? row.heatUntil.getTime() - now : 0;
	const skipping = Boolean(
		row.skipFrom && row.skipUntil && row.skipFrom.getTime() <= now && now < row.skipUntil.getTime()
	);
	const target: ScheduleTarget = {
		id: plugId,
		satellite: live.satellite,
		deviceId: row.deviceId,
		params: {
			jobs: jobsFor(schedules, !row.paused && heatLeft <= 0, skipping),
			replace: row.scheduleJobs
		}
	};
	if (row.paused) target.params.off = true;
	else if (heatLeft > 0) target.params.onFor = Math.ceil(heatLeft / 1000);
	return target;
}

/**
 * The schedules a device signed (#643), done by its satellite: the new jobs' ids kept, as
 * syncPlug keeps them. False if it is not the family's, or not a schedule order of that plug.
 */
export async function applySignedSchedules(userId: string, plugId: string, signed: SignedOrder) {
	const [row] = await withFamily(userId, (tx, { familyId }) =>
		tx
			.select({ deviceId: plug.deviceId, familyId: sql<string>`${familyId}` })
			.from(plug)
			.where(eq(plug.id, plugId))
	);
	if (!row) return false;
	try {
		const e = JSON.parse(signed.envelope) as { plug?: unknown; method?: unknown };
		if (e.plug !== row.deviceId || e.method !== 'Satelite.Horarios') return false;
	} catch {
		return false;
	}
	const { jobs } = (await hub.callSigned(plugId, signed)) as { jobs?: unknown };
	const made = Array.isArray(jobs) ? jobs.filter((id): id is number => Number.isInteger(id)) : [];
	await asFamily(row.familyId, (tx) =>
		tx.update(plug).set({ scheduleJobs: made }).where(eq(plug.id, plugId))
	);
	hub.changed(row.familyId);
	return true;
}

/**
 * The plug made to match what Seilide keeps of it: its time zone the family's, its schedule jobs
 * (only Seilide's: what the Shelly app put stays), off while paused, and on through a long heat.
 * Not connected, it is done when it connects.
 */
export async function syncPlug(familyId: string, plugId: string) {
	if (!hub.connected(plugId)) return;
	const { row, schedules } = await planOf(familyId, plugId);
	// A sensor (#508) has no switch nor schedules, and is awake only for a moment.
	if (!row || isSensorDevice(row.deviceId)) return;

	const config = (await hub.call(plugId, 'Sys.GetConfig')) as { location?: { tz?: unknown } };
	if (config?.location?.tz !== TIME_ZONE)
		await hub.call(plugId, 'Sys.SetConfig', { config: { location: { tz: TIME_ZONE } } });

	const now = Date.now();
	const heatLeft = row.heatUntil ? row.heatUntil.getTime() - now : 0;
	if (heatLeft > 0) {
		heats.set(plugId, { familyId, until: row.heatUntil!.getTime() });
		// After a restart its timer is gone: on again, for what is left.
		await hub.call(plugId, 'Switch.Set', {
			id: SWITCH_ID,
			on: true,
			toggle_after: Math.ceil(heatLeft / 1000)
		});
	} else if (row.heatUntil) {
		await asFamily(familyId, (tx) =>
			tx.update(plug).set({ heatUntil: null }).where(eq(plug.id, plugId))
		);
	}
	if (row.paused) await hub.call(plugId, 'Switch.Set', { id: SWITCH_ID, on: false });

	// A skip (#557): kept to sync again at its edges; inside it, its «on» jobs off.
	const skipping = Boolean(
		row.skipFrom && row.skipUntil && row.skipFrom.getTime() <= now && now < row.skipUntil.getTime()
	);
	if (row.skipFrom && row.skipUntil && row.skipUntil.getTime() > now)
		skips.set(plugId, {
			familyId,
			from: row.skipFrom.getTime(),
			until: row.skipUntil.getTime(),
			inside: skipping
		});
	else skips.delete(plugId);
	const want = jobsFor(schedules, !row.paused && heatLeft <= 0, skipping);
	const { jobs } = (await hub.call(plugId, 'Schedule.List')) as { jobs: ShellyJob[] };
	// Only those it made: a reset plug may give their numbers to its own (its updates).
	const ours = jobs.filter(
		(j) => row.scheduleJobs.includes(j.id) && j.calls?.every((c) => c.method === 'Switch.Set')
	);
	if (ours.length === want.length && ours.every((j, i) => sameJob(j, want[i]!))) return;

	for (const job of ours) await hub.call(plugId, 'Schedule.Delete', { id: job.id });
	const made: number[] = [];
	for (const job of want) {
		const { id } = (await hub.call(plugId, 'Schedule.Create', {
			enable: job.enable,
			timespec: job.timespec,
			calls: [{ method: 'Switch.Set', params: { id: SWITCH_ID, on: job.on } }]
		})) as { id: number };
		made.push(id);
	}
	await asFamily(familyId, (tx) =>
		tx.update(plug).set({ scheduleJobs: made }).where(eq(plug.id, plugId))
	);
}

/** The family's plug, with what the schedules and the pause need; null if not the family's. */
async function familyPlug(userId: string, plugId: string) {
	const [row] = await withFamily(userId, (tx, { familyId }) =>
		tx
			.select({
				id: plug.id,
				familyId: sql<string>`${familyId}`,
				kind: plug.kind,
				paused: plug.paused,
				pausedAt: plug.pausedAt,
				locked: plug.locked
			})
			.from(plug)
			.where(eq(plug.id, plugId))
	);
	return row ?? null;
}

/** Synced now if connected; if not, when it connects. A failure is only logged: it is tried again then. */
async function trySync(familyId: string, plugId: string) {
	// Through a satellite that does not let Seilide do it alone (#643): it would only be refused.
	const now = hub.liveOf(plugId);
	if (now.relayed && !now.auto) return;
	try {
		await syncPlug(familyId, plugId);
	} catch (e) {
		if (!(e instanceof PlugOffline)) console.error(`[enchufes] ${plugId}: sin sincronizar`, e);
	}
}

/** A schedule more: saved, and written to the plug. */
export async function addSchedule(
	userId: string,
	plugId: string,
	input: PlugScheduleInput
): Promise<{ problem: string } | { ok: true }> {
	const checked = checkSchedule(input);
	if ('problem' in checked) return checked;
	const p = await familyPlug(userId, plugId);
	if (!p) return { problem: 'Ese enchufe ya no está' };
	if (p.locked) return { problem: LOCKED_PROBLEM };
	const added = await withFamily(userId, async (tx, { familyId }) => {
		const [{ n }] = (await tx
			.select({ n: count() })
			.from(plugSchedule)
			.where(eq(plugSchedule.plugId, plugId))) as [{ n: number }];
		if (n >= MAX_SCHEDULES) return false;
		await tx.insert(plugSchedule).values({ plugId, familyId, ...checked.ok });
		return true;
	});
	if (!added) return { problem: `Como mucho ${MAX_SCHEDULES} horarios por enchufe` };
	hub.changed(p.familyId);
	await trySync(p.familyId, plugId);
	return { ok: true };
}

export async function deleteSchedule(userId: string, plugId: string, id: number) {
	const p = await familyPlug(userId, plugId);
	if (!p) return;
	await withFamily(userId, (tx) =>
		tx.delete(plugSchedule).where(and(eq(plugSchedule.id, id), eq(plugSchedule.plugId, plugId)))
	);
	hub.changed(p.familyId);
	await trySync(p.familyId, plugId);
}

/**
 * «En pausa» (a water heater in summer, on holiday): off, and its schedules off. Out of a long pause,
 * or after a long time using nothing, a water heater heats for HEAT_MS first, against legionella,
 * and its schedules come back after. Whether it heats, said back; `locked`, not done (either way:
 * both switch it).
 */
export async function setPaused(userId: string, plugId: string, paused: boolean) {
	return setPausedIn(await kitchenOfUser(userId), plugId, paused);
}

/**
 * The same in a kitchen (#557: the voice, a satellite's too, Preguntar, an errand). False if it is
 * not the family's; already so, nothing done.
 */
export async function setPausedIn(
	k: Pick<Kitchen, 'familyId' | 'run'>,
	plugId: string,
	paused: boolean
): Promise<{ heats: boolean; locked?: true; gone?: true }> {
	const [p] = await k.run((tx) =>
		tx
			.select({
				kind: plug.kind,
				paused: plug.paused,
				pausedAt: plug.pausedAt,
				locked: plug.locked
			})
			.from(plug)
			.where(eq(plug.id, plugId))
	);
	if (!p) return { heats: false, gone: true };
	if (p.paused === paused) return { heats: false };
	if (p.locked) return { heats: false, locked: true };
	const now = new Date();
	let heatUntil: Date | null = null;
	if (!paused && p.kind === 'termo') {
		const longPause = p.pausedAt !== null && now.getTime() - p.pausedAt.getTime() >= LONG_PAUSE_MS;
		const [{ wh }] = (await k.run((tx) =>
			tx
				.select({ wh: sql<number>`coalesce(sum(${plugEnergy.wh}), 0)` })
				.from(plugEnergy)
				.where(
					and(
						eq(plugEnergy.plugId, plugId),
						gte(plugEnergy.hour, new Date(now.getTime() - LONG_PAUSE_MS))
					)
				)
		)) as [{ wh: number }];
		if (longPause || Number(wh) < NOTHING_WH) heatUntil = new Date(now.getTime() + HEAT_MS);
	}
	await k.run((tx) =>
		tx
			.update(plug)
			.set({ paused, pausedAt: paused ? now : null, heatUntil })
			.where(eq(plug.id, plugId))
	);
	hub.changed(k.familyId);
	await trySync(k.familyId, plugId);
	return { heats: heatUntil !== null };
}

/**
 * Its schedules' «on» skipped from `from` to `until` (#557: «que no se encienda solo esta tarde»),
 * replacing any it had; both null, none (its schedules back now). Not with its padlock, as no new
 * schedules then. `gone`, not the family's.
 */
export async function setSkipIn(
	k: Pick<Kitchen, 'familyId' | 'run'>,
	plugId: string,
	from: Date | null,
	until: Date | null
): Promise<{ locked?: true; gone?: true }> {
	const [p] = await k.run((tx) =>
		tx.select({ locked: plug.locked }).from(plug).where(eq(plug.id, plugId))
	);
	if (!p) return { gone: true };
	if (p.locked) return { locked: true };
	await k.run((tx) =>
		tx
			.update(plug)
			.set({ skipFrom: from && until ? from : null, skipUntil: from && until ? until : null })
			.where(eq(plug.id, plugId))
	);
	if (!from || !until) skips.delete(plugId);
	hub.changed(k.familyId);
	await trySync(k.familyId, plugId);
	return {};
}

/** What is said when the padlock stops something. */
export const LOCKED_PROBLEM = 'Tiene el candado puesto: quítalo antes';

/**
 * «Con candado», or without: any adult of the family. Only a mark in Seilide, the plug is not told,
 * and its own button still works.
 */
export async function setLocked(userId: string, plugId: string, locked: boolean) {
	const [row] = await withFamily(userId, (tx, { familyId }) =>
		tx
			.update(plug)
			.set({ locked })
			.where(eq(plug.id, plugId))
			.returning({ familyId: sql<string>`${familyId}` })
	);
	if (row) hub.changed(row.familyId);
	return !!row;
}

/**
 * The sensor of «la casa» (#557): this one, and no other of the family; `home` false, none (with
 * one sensor only, it is that one anyway). Any adult of the family.
 */
export async function setHomeSensor(userId: string, plugId: string, home: boolean) {
	return withFamily(userId, async (tx) => {
		const [row] = await tx.select({ id: plug.id }).from(plug).where(eq(plug.id, plugId));
		if (!row) return false;
		await tx
			.update(plug)
			.set({ home: false })
			.where(and(eq(plug.home, true), ne(plug.id, plugId)));
		await tx.update(plug).set({ home }).where(eq(plug.id, plugId));
		return true;
	});
}

/** Its notices as chosen (#396, phase 3): watched from now on. */
export async function setNotices(userId: string, plugId: string, notices: PlugNotices) {
	const [row] = await withFamily(userId, (tx, { familyId }) =>
		tx
			.update(plug)
			.set({
				notifyDone: notices.done,
				notifyStopped: notices.stopped,
				notifyOffline: notices.offline,
				notifyOnHours: notices.onHours,
				notifyAloud: notices.aloud
			})
			.where(eq(plug.id, plugId))
			.returning({ familyId: sql<string>`${familyId}` })
	);
	if (!row) return;
	watcher()?.load(row.familyId, plugId);
	hub.changed(row.familyId);
}
