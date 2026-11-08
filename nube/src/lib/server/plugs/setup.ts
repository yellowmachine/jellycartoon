import { isNotNull } from 'drizzle-orm';
import { plug } from '../db/schema.ts';
import { withFamily } from '../family.ts';
import { familySatellites, nudgeSatellite } from '../satellites.ts';
import { createPlug, deletePlug } from './plugs.ts';
import { createSatelliteTasks, SatelliteSilent, type SatelliteTasks } from './satellite-tasks.ts';
import { PLUG_PATH, plugAddress, type FoundPlugView, type PlugKind } from '#lib/plugs.ts';

/**
 * Setting up plugs from a satellite (#396): «Buscar enchufes» asks every satellite of the family
 * for the Shelly in its network, and «Añadir» has one of them point the chosen plug at Seilide. No
 * IP, no address to copy. Families without satellites copy the address by hand.
 */

const KEY = Symbol.for('seilide.enchufes.satelites');
const globals = globalThis as unknown as Record<symbol, SatelliteTasks | undefined>;
const tasks: SatelliteTasks = (globals[KEY] ??= createSatelliteTasks(nudgeSatellite));

/** For /api/satelite/avisos and /api/satelite/enchufes. */
export const plugTasksFor = (satelliteId: string) => tasks.pendingFor(satelliteId);
export const plugTaskAnswered = tasks.answer;

const familyOf = (userId: string) => withFamily(userId, async (_, m) => m.familyId);

export async function satellitesOf(userId: string) {
	return familySatellites(await familyOf(userId));
}

/**
 * The Shelly the family's satellites see, each once, with which of them saw it, and whether it is
 * one of the family's plugs already. `silent`, those that did not answer.
 */
export async function searchPlugs(userId: string, origin: string) {
	const satellites = await satellitesOf(userId);
	const answers = await Promise.allSettled(
		satellites.map((s) => tasks.ask(s.id, { kind: 'buscar' }))
	);
	const added = new Map(
		(
			await withFamily(userId, (tx) =>
				tx
					.select({ deviceId: plug.deviceId, name: plug.name })
					.from(plug)
					.where(isNotNull(plug.deviceId))
			)
		).map((p) => [p.deviceId!, p.name])
	);
	const ours = `${origin.replace(/^http/, 'ws')}${PLUG_PATH}`;
	const found = new Map<string, FoundPlugView>();
	const silent: string[] = [];
	answers.forEach((answer, i) => {
		const satellite = satellites[i]!;
		if (answer.status === 'rejected' || answer.value.problem) return silent.push(satellite.name);
		for (const p of answer.value.found ?? [])
			if (!found.has(p.deviceId))
				found.set(p.deviceId, {
					deviceId: p.deviceId,
					model: p.model,
					ip: p.ip,
					auth: p.auth,
					satelliteId: satellite.id,
					satelliteName: satellite.name,
					added: added.get(p.deviceId) ?? null,
					elsewhere: p.server !== null && !p.server.startsWith(ours)
				});
	});
	return { found: [...found.values()], silent, satellites: satellites.length };
}

/**
 * A plug found by a satellite, added and pointed at Seilide by it. If the satellite cannot, the
 * plug is not kept: it says why.
 */
export async function addFoundPlug(
	userId: string,
	origin: string,
	found: { satelliteId: string; deviceId: string; ip: string; name: string; kind: PlugKind }
): Promise<{ id: string } | { problem: string }> {
	if (!(await satellitesOf(userId)).some((s) => s.id === found.satelliteId))
		return { problem: 'Ese satélite no es de la familia' };
	const { id, token } = await createPlug(userId, found.name, found.kind, found.deviceId);
	let problem: string | undefined;
	try {
		({ problem } = await tasks.ask(found.satelliteId, {
			kind: 'configurar',
			ip: found.ip,
			deviceId: found.deviceId,
			server: plugAddress(origin, token)
		}));
	} catch (e) {
		if (!(e instanceof SatelliteSilent)) throw e;
		problem = 'El satélite no contesta: puede que esté apagado o sin actualizar';
	}
	if (!problem) return { id };
	await deletePlug(userId, id);
	return { problem };
}
