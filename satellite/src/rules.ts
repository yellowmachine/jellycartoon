import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	canonicalRules,
	validRules,
	voiceChangeOk,
	VOICE_RULES_MS,
	type SatelliteRule
} from '../../packages/comun/src/plug-rules.ts';
import { ANY_PLUG, type Trust } from './trust.ts';

/**
 * The plug rules this satellite keeps (#651, phase 2): what Seilide offers it, taken only signed by
 * a device given here (`Satelite.Reglas`, the whole list), or, unsigned, right after it heard an
 * order itself and only adding or taking out rules of its own plugs (said to it: the family's
 * choice). Kept in /data/reglas.json, whole or not at all. Not done yet: that is phase 3.
 */

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
			if (validRules({ version: k.version, rules: k.rules })) return k;
		} catch {
			// None yet.
		}
		return { version: 0, rules: [], by: '', at: '' };
	}
	function save(k: Kept) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(`${file}.nuevo`, JSON.stringify(k), { mode: 0o600 });
		renameSync(`${file}.nuevo`, file);
		kept = k;
	}

	return {
		version: () => kept.version,
		rules: () => kept.rules,
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
				if (orderAgo() > VOICE_RULES_MS)
					return { taken: false, why: 'sin firmar y sin una orden oída aquí' };
				if (!voiceChangeOk(kept.rules, unsigned.rules, ownPlug))
					return { taken: false, why: 'sin firmar, cambia reglas firmadas o enchufes de otro' };
				list = unsigned;
				by = 'voz';
			}
			save({
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
