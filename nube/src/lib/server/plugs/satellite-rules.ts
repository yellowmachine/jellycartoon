import { and, eq, isNotNull } from 'drizzle-orm';
import { canonicalRules, sameRules, validRules, type SatelliteRule } from 'comun/plug-rules.ts';
import type { PlugGuard } from 'comun/plug-rules.ts';
import { plug, voiceSatellite } from '#lib/server/db/schema.ts';
import type { OfferedPlugRules } from '#lib/server/db/voice.schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { houseKitchen, type Kitchen } from '#lib/server/fridge.ts';
import { allRules } from '#lib/server/rules.ts';
import { satelliteRuleOf } from './satellite-rule-of.ts';
import { tellSatellite } from '#lib/server/satellite-live.ts';

/**
 * The family's plug rules a satellite can do by itself (#651, phase 2): those that switch a plug of
 * its (on or off, not its pause), every day or on one day at a time, or when a plug of its starts or
 * ends a cycle, without conditions. Seilide offers them as a whole list, with a version that only
 * goes up; a device given to that satellite signs it (Enchufes), or, said to the satellite, it goes
 * unsigned and the satellite takes it only then (satellite/src/rules.ts). Seilide still does them
 * itself until phase 3.
 */

/** What that satellite should keep now, by the family's rules and plugs. */
export async function satelliteRulesFor(k: Kitchen, fp: string) {
	const [rules, plugs] = await Promise.all([
		allRules(k),
		k.run((tx) =>
			tx
				.select({
					id: plug.id,
					name: plug.name,
					kind: plug.kind,
					deviceId: plug.deviceId,
					satelliteFp: plug.satelliteFp
				})
				.from(plug)
				.where(eq(plug.familyId, k.familyId))
		)
	]);
	return canonicalRules(
		rules.map((r) => satelliteRuleOf(r, plugs, fp)).filter((r): r is SatelliteRule => r !== null)
	);
}

/** A satellite of the family with its key's fingerprint known, and what it was offered. */
interface SatelliteRow {
	id: string;
	name: string;
	trustFp: string | null;
	plugRules: OfferedPlugRules | null;
	plugRulesKept: number;
}

function satellitesOf(k: Kitchen): Promise<SatelliteRow[]> {
	return k.run((tx) =>
		tx
			.select({
				id: voiceSatellite.id,
				name: voiceSatellite.name,
				trustFp: voiceSatellite.trustFp,
				plugRules: voiceSatellite.plugRules,
				plugRulesKept: voiceSatellite.plugRulesKept
			})
			.from(voiceSatellite)
			.where(and(eq(voiceSatellite.familyId, k.familyId), isNotNull(voiceSatellite.trustFp)))
	);
}

/** The next version: over what it was offered and what it keeps (said by voice, say). */
const nextVersion = (s: SatelliteRow) => Math.max(s.plugRules?.version ?? 0, s.plugRulesKept) + 1;

/**
 * For Enchufes: each satellite's rules, and what a device of it has to sign, if they changed since
 * they were last offered (or it has not taken them). Its fingerprint, for the device to sign for it.
 */
export async function satelliteRulesState(k: Kitchen) {
	const out = [];
	for (const s of await satellitesOf(k)) {
		const rules = await satelliteRulesFor(k, s.trustFp!);
		const offered = s.plugRules;
		const same = offered !== null && sameRules(offered.rules, rules);
		out.push({
			id: s.id,
			name: s.name,
			fp: s.trustFp!,
			count: rules.length,
			/** Of them, those Seilide asks for (#651, phase 4): conditions, or a moment only it knows. */
			asked: rules.filter((r) => r.asked).length,
			/** It keeps what it was offered last. */
			kept: same && s.plugRulesKept >= offered!.version,
			/** None to sign: the same as offered (it may not have taken them yet: it is told again). */
			toSign: same || (!rules.length && !offered) ? null : { version: nextVersion(s), rules }
		});
	}
	return out;
}

/**
 * A device signed a satellite's list (Enchufes): kept as offered, and told to it at once. Only the
 * list Seilide would offer now, and only for that satellite; the satellite checks the signature.
 */
export async function offerSignedRules(
	familyId: string,
	satelliteId: string,
	envelope: string,
	sig: string
) {
	const k = houseKitchen(familyId);
	const s = (await satellitesOf(k)).find((x) => x.id === satelliteId);
	if (!s) return 'Ese satélite no es de la familia, o aún no ha dicho su clave';
	let e: { sat?: unknown; plug?: unknown; method?: unknown; params?: unknown };
	try {
		e = JSON.parse(envelope);
	} catch {
		return 'La firma no tiene sentido';
	}
	if (
		e.sat !== s.trustFp ||
		e.plug !== null ||
		e.method !== 'Satelite.Reglas' ||
		!validRules(e.params)
	)
		return 'La firma no es de estas reglas';
	if (e.params.version < nextVersion(s)) return 'Las reglas han cambiado: fírmalas otra vez';
	const offered: OfferedPlugRules = {
		version: e.params.version,
		rules: canonicalRules(e.params.rules),
		envelope,
		sig
	};
	await asFamily(familyId, (tx) =>
		tx.update(voiceSatellite).set({ plugRules: offered }).where(eq(voiceSatellite.id, satelliteId))
	);
	tellSatellite(satelliteId);
	return null;
}

/**
 * A rule said to a satellite, saved or taken out (#651): offered unsigned, at once, while it has
 * just heard the order (it takes it only then, and only adding or taking out). Only that rule
 * changes from what it was offered: the others still wait for a device to sign them.
 */
export async function offerSaidRule(k: Kitchen, satelliteId: string, ruleId: number) {
	const house = houseKitchen(k.familyId);
	const s = (await satellitesOf(house)).find((x) => x.id === satelliteId);
	if (!s) return;
	const said = (await satelliteRulesFor(house, s.trustFp!)).find((r) => r.id === ruleId);
	const before = s.plugRules?.rules ?? [];
	const rules = canonicalRules([...before.filter((r) => r.id !== ruleId), ...(said ? [said] : [])]);
	if (sameRules(before, rules)) return;
	const offered: OfferedPlugRules = { version: nextVersion(s), rules };
	await asFamily(k.familyId, (tx) =>
		tx.update(voiceSatellite).set({ plugRules: offered }).where(eq(voiceSatellite.id, satelliteId))
	);
	tellSatellite(satelliteId);
}

/** For its notices: what it is offered now; null, none. */
export async function offeredRulesOf(k: Kitchen, satelliteId: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ plugRules: voiceSatellite.plugRules })
			.from(voiceSatellite)
			.where(eq(voiceSatellite.id, satelliteId))
	);
	return row?.plugRules ?? null;
}

/**
 * Errands done (#651, phase 3), out of a satellite's list without a signature: only when all that
 * changed is that, which the satellite takes only for errands it did itself (satellite/src/rules.ts).
 * Else the list waits for a device to sign it.
 */
export async function offerDoneErrands(familyId: string, satelliteId: string) {
	const house = houseKitchen(familyId);
	const s = (await satellitesOf(house)).find((x) => x.id === satelliteId);
	if (!s?.plugRules) return;
	const rules = await satelliteRulesFor(house, s.trustFp!);
	const before = s.plugRules.rules;
	if (sameRules(before, rules)) return;
	const kept = new Map(before.map((r) => [r.id, r]));
	const onlyGone =
		rules.every((r) => kept.has(r.id) && sameRules([kept.get(r.id)!], [r])) &&
		before.filter((r) => !rules.some((x) => x.id === r.id)).every((r) => r.once);
	if (!onlyGone) return;
	const offered: OfferedPlugRules = { version: nextVersion(s), rules };
	await asFamily(familyId, (tx) =>
		tx.update(voiceSatellite).set({ plugRules: offered }).where(eq(voiceSatellite.id, satelliteId))
	);
	tellSatellite(satelliteId);
}

/**
 * For its notices (#651, phase 3): what stops each of its plugs' rules, by the Shelly's id, as
 * switchIn looks at it. Unsigned: it can only make the satellite do less.
 */
export async function guardsFor(k: Kitchen, satelliteId: string) {
	const [sat] = await k.run((tx) =>
		tx
			.select({ fp: voiceSatellite.trustFp })
			.from(voiceSatellite)
			.where(eq(voiceSatellite.id, satelliteId))
	);
	const fp = sat?.fp;
	if (!fp) return {};
	const rows = await k.run((tx) =>
		tx
			.select({
				deviceId: plug.deviceId,
				locked: plug.locked,
				paused: plug.paused,
				heatUntil: plug.heatUntil,
				skipFrom: plug.skipFrom,
				skipUntil: plug.skipUntil
			})
			.from(plug)
			.where(and(eq(plug.familyId, k.familyId), eq(plug.satelliteFp, fp)))
	);
	const guards: Record<string, PlugGuard> = {};
	for (const r of rows)
		if (r.deviceId)
			guards[r.deviceId] = {
				locked: r.locked,
				paused: r.paused,
				heatUntil: r.heatUntil ? r.heatUntil.getTime() : null,
				// «Esta tarde no» (#651, phase 5): its schedules do not switch it on then.
				...(r.skipFrom && r.skipUntil && r.skipUntil > new Date()
					? { skipFrom: r.skipFrom.getTime(), skipUntil: r.skipUntil.getTime() }
					: {})
			};
	return guards;
}
