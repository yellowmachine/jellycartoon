import { eq, isNotNull } from 'drizzle-orm';
import type { Tool } from '../openrouter.ts';
import { plug } from '../db/schema.ts';
import { withFamily } from '../family.ts';
import { familySatellites, nudgeSatellite } from '../satellites.ts';
import { newPlugToken } from './plug-key-scope.ts';
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

/**
 * A plug that comes straight to Seilide, pointed at a satellite instead (#643), which then lets down
 * only what it allows. With a new address, so that the old one, which went straight, no longer
 * works; the old one back if no satellite could. Each of the family's satellites is tried: it only
 * touches the plug if it finds that same Shelly at its IP.
 */
export async function moveToSatellite(
	userId: string,
	origin: string,
	plugId: string
): Promise<{ ok: true } | { problem: string }> {
	const [row] = await withFamily(userId, (tx) =>
		tx
			.select({ deviceId: plug.deviceId, ip: plug.ip, hash: plug.hash })
			.from(plug)
			.where(eq(plug.id, plugId))
	);
	if (!row) return { problem: 'Ese enchufe ya no está' };
	if (!row.deviceId || !row.ip)
		return { problem: 'Seilide aún no sabe dónde está en la wifi: espera a que se conecte' };
	const satellites = await satellitesOf(userId);
	if (!satellites.length) return { problem: 'Hace falta un satélite de voz en casa' };

	const made = newPlugToken();
	const setHash = (hash: string) =>
		withFamily(userId, (tx) => tx.update(plug).set({ hash }).where(eq(plug.id, plugId)));
	await setHash(made.hash);
	let problem = 'El satélite no contesta: puede que esté apagado o sin actualizar';
	for (const satellite of satellites) {
		try {
			const done = await tasks.ask(satellite.id, {
				kind: 'configurar',
				ip: row.ip,
				deviceId: row.deviceId,
				server: plugAddress(origin, made.token)
			});
			if (!done.problem) return { ok: true };
			problem = done.problem;
		} catch (e) {
			if (!(e instanceof SatelliteSilent)) throw e;
		}
	}
	await setHash(row.hash);
	return { problem };
}

/** The window «añade un aparato» opened (#643), by family: for its page to show the link. */
const openings = new Map<string, { satellite: string; url: string | null; until: number }>();

/**
 * «Añade un aparato», said to a satellite (#643): it opens its window for five minutes, only if it
 * heard the order itself. Its page's address, for the voice and for Enchufes; or why not.
 */
export async function openEnrolment(familyId: string, satellite: { id: string; name: string }) {
	try {
		const done = await tasks.ask(satellite.id, { kind: 'abrir-alta' });
		if (done.problem) return { problem: done.problem };
		const until = done.until ?? Date.now() + 5 * 60_000;
		openings.set(familyId, { satellite: satellite.name, url: done.url ?? null, until });
		return { url: done.url ?? null, until };
	} catch (e) {
		if (!(e instanceof SatelliteSilent)) throw e;
		return { problem: 'El satélite no contesta: puede que esté sin actualizar' };
	}
}

/** The family's open window, if any: which satellite, its page, until when. */
export function enrolmentOf(familyId: string) {
	const open = openings.get(familyId);
	if (!open || open.until <= Date.now()) return null;
	return open;
}

/**
 * A device given to the family's satellite with the code from its page (#643): its public key, its
 * name and the MAC made with the code, which only the satellite with that code accepts. What it
 * answers, signed, the device checks against the code's fingerprint: Seilide only carries it.
 */
export async function enrolDevice(
	userId: string,
	device: { publicKey: string; name: string; mac: string }
): Promise<
	{ enrolled: { fp: string; satellite: string; ack: string }; name: string } | { problem: string }
> {
	const satellites = await satellitesOf(userId);
	if (!satellites.length) return { problem: 'Hace falta un satélite de voz en casa' };
	let problem = 'El satélite no contesta: puede que esté apagado o sin actualizar';
	for (const satellite of satellites) {
		try {
			const done = await tasks.ask(satellite.id, { kind: 'alta', ...device });
			if (done.enrolled) {
				openings.delete(await familyOf(userId));
				return { enrolled: done.enrolled, name: satellite.name };
			}
			if (done.problem) problem = done.problem;
		} catch (e) {
			if (!(e instanceof SatelliteSilent)) throw e;
		}
	}
	return { problem };
}

export const deviceEnrolTool: Tool = {
	type: 'function',
	function: {
		name: 'device_enrol',
		description:
			'Abre durante cinco minutos el alta de aparatos de este satélite (#643), para que un móvil o una tablet pueda encender y apagar los enchufes con su firma: «añade un aparato», «dar de alta el móvil», «abre el alta». Solo dicho a un satélite.',
		parameters: { type: 'object', properties: {}, additionalProperties: false }
	}
};

/** What `device_enrol` did, in words for the model. */
export async function enrolByVoice(
	familyId: string,
	satellite: { id: string; name: string }
): Promise<{ result: string; done: boolean }> {
	const opened = await openEnrolment(familyId, satellite);
	if ('problem' in opened) return { result: `No se ha abierto: ${opened.problem}.`, done: false };
	return {
		result: `Abierto cinco minutos. En el móvil o la tablet, dentro de la wifi de casa, que abra Enchufes en Seilide: ahí está el enlace a la página del satélite${opened.url ? ` (${opened.url})` : ''}, donde copia el código, y luego lo pega en «Dar de alta este aparato». Dilo corto, sin leer la dirección.`,
		done: true
	};
}
