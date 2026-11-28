import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	canonicalRules,
	sameRule,
	validGuards,
	validRules,
	voiceChangeOk,
	VOICE_RULES_MS,
	type PlugGuard,
	type RuleDone,
	type SatelliteRule
} from '../../packages/comun/src/plug-rules.ts';
import { ANY_PLUG, type Trust } from './trust.ts';

/**
 * The plug rules this satellite keeps (#651, phase 2): what Seilide offers it, taken only signed by
 * a device given here (`Satelite.Reglas`, the whole list), or, unsigned, right after it heard an
 * order itself and only adding or taking out rules of its own plugs (said to it: the family's
 * choice). Kept in /data/reglas.json, whole or not at all, with what stops them (each plug's padlock,
 * pause and long heat, as Seilide last said), which times were done already, and what is still to
 * be told to Seilide (phase 3: rule-runner.ts does them).
 */

/** Times done kept, the last ones: enough for days of rules. */
const MAX_DONE = 500;
/** What is still to be told to Seilide, at most (offline for days, the oldest go). */
const MAX_OUTBOX = 200;

/** As Seilide offers it, in its notices: the list, and the device's signature if there is one. */
export interface OfferedRules {
	version: number;
	rules: SatelliteRule[];
	envelope?: string;
	sig?: string;
}

interface Kept {
	version: number;
	rules: SatelliteRule[];
	/** Who: the device's name, or «voz». */
	by: string;
	at: string;
	guards?: Record<string, PlugGuard>;
	/** «<rule id>|<key>»: done, not again. */
	done?: string[];
	outbox?: RuleDone[];
}

export interface RulesOptions {
	file: string;
	trust: Trust;
	/** How long ago it sent Seilide an order it heard itself (server.ts). */
	orderAgo: () => number;
	/** A plug that comes through this satellite (relay.ts). */
	ownPlug: (shellyId: string) => boolean;
	log: (message: string) => void;
	now?: () => number;
}

export function createRules({ file, trust, orderAgo, ownPlug, log, now = Date.now }: RulesOptions) {
	let kept: Kept = load();

	function load(): Kept {
		try {
			const k = JSON.parse(readFileSync(file, 'utf8')) as Kept;
			if (validRules({ version: k.version, rules: k.rules }))
				return {
					...k,
					guards: validGuards(k.guards) ? k.guards : {},
					done: Array.isArray(k.done) ? k.done : [],
					outbox: Array.isArray(k.outbox) ? k.outbox : []
				};
		} catch {
			// None yet.
		}
		return { version: 0, rules: [], by: '', at: '', guards: {}, done: [], outbox: [] };
	}
	function save(k: Kept) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(`${file}.nuevo`, JSON.stringify(k), { mode: 0o600 });
		renameSync(`${file}.nuevo`, file);
		kept = k;
	}

	/**
	 * Unsigned, also without a heard order (#651, phase 3): only taking out errands this satellite
	 * did itself (once, and in its times done); all the rest as it was.
	 */
	function doneErrandsGone(before: SatelliteRule[], after: SatelliteRule[]) {
		const had = new Map(before.map((r) => [r.id, r]));
		if (!after.every((r) => had.has(r.id) && sameRule(had.get(r.id)!, r))) return false;
		const gone = before.filter((r) => !after.some((a) => a.id === r.id));
		return (
			gone.length > 0 &&
			gone.every((r) => r.once && (kept.done ?? []).some((d) => d.startsWith(`${r.id}|`)))
		);
	}

	return {
		version: () => kept.version,
		rules: () => kept.rules,
		guard: (shellyId: string) => kept.guards?.[shellyId],
		/** What Seilide says stops each plug now: kept for when there is no internet. */
		setGuards(g: unknown) {
			if (!validGuards(g) || JSON.stringify(g) === JSON.stringify(kept.guards ?? {})) return;
			save({ ...kept, guards: g });
		},
		isDone: (id: number, key: string) => (kept.done ?? []).includes(`${id}|${key}`),
		/** A rule's times done, as kept (the last ones). */
		doneKeys: (id: number) =>
			(kept.done ?? []).filter((d) => d.startsWith(`${id}|`)).map((d) => d.slice(`${id}|`.length)),
		/** Done (or let go): not again, also after a restart. */
		markDone(id: number, key: string) {
			save({ ...kept, done: [...(kept.done ?? []), `${id}|${key}`].slice(-MAX_DONE) });
		},
		outbox: () => kept.outbox ?? [],
		/** To be told to Seilide, kept until it is. */
		queue(d: RuleDone) {
			save({ ...kept, outbox: [...(kept.outbox ?? []), d].slice(-MAX_OUTBOX) });
		},
		/** Told: out of the box. */
		sent(n: number) {
			save({ ...kept, outbox: (kept.outbox ?? []).slice(n) });
		},
		/** What Seilide offers: taken, or why not. Older or the same version, nothing to do. */
		offer(o: OfferedRules): { taken: boolean; why?: string } {
			if (!o || !Number.isSafeInteger(o.version) || o.version <= kept.version)
				return { taken: false };
			let list: { version: number; rules: SatelliteRule[] };
			let by: string;
			if (o.envelope && o.sig) {
				const c = trust.check(o.envelope, o.sig, ANY_PLUG, { fresh: false });
				if (!c.ok) return { taken: false, why: c.why };
				if (c.method !== 'Satelite.Reglas') return { taken: false, why: 'no son reglas' };
				const params = c.params;
				if (!validRules(params)) return { taken: false, why: 'reglas sin sentido' };
				if (params.version <= kept.version) return { taken: false, why: 'reglas más antiguas' };
				list = params;
				by = c.device;
			} else {
				const unsigned = { version: o.version, rules: o.rules };
				if (!validRules(unsigned)) return { taken: false, why: 'reglas sin sentido' };
				if (doneErrandsGone(kept.rules, unsigned.rules)) {
					list = unsigned;
					by = 'encargos hechos';
				} else {
					if (orderAgo() > VOICE_RULES_MS)
						return { taken: false, why: 'sin firmar y sin una orden oída aquí' };
					if (!voiceChangeOk(kept.rules, unsigned.rules, ownPlug))
						return { taken: false, why: 'sin firmar, cambia reglas firmadas o enchufes de otro' };
					list = unsigned;
					by = 'voz';
				}
			}
			save({
				...kept,
				version: list.version,
				rules: canonicalRules(list.rules),
				by,
				at: new Date(now()).toISOString()
			});
			log(`Reglas de enchufes: versión ${list.version}, ${list.rules.length}, de ${by}`);
			return { taken: true };
		}
	};
}

export type Rules = ReturnType<typeof createRules>;
