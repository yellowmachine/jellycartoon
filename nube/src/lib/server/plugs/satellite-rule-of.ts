import { MAX_PLUG_MIN, type SatelliteRule } from 'comun/plug-rules.ts';
import { PLUG_KINDS } from '#lib/plugs.ts';
import type { Rule } from '#lib/server/rule-check.ts';
import { hasWords } from '#lib/server/voice/learned.ts';

/**
 * Whether a family's rule can be done by a satellite by itself (#651), and how it keeps it: see
 * satellite-rules.ts. Apart, to be tried without a database.
 */

export interface PlugRow {
	id: string;
	name: string;
	kind: keyof typeof PLUG_KINDS;
	deviceId: string | null;
	satelliteFp: string | null;
}

/**
 * The rule as the satellite keeps it, if it can; null if not there. One with conditions, or whose
 * moment only Seilide knows (the weather, arriving home, a plug through another satellite…), goes
 * `asked` (#651, phase 4): Seilide says when, the satellite does what was signed.
 */
export function satelliteRuleOf(r: Rule, plugs: PlugRow[], fp: string): SatelliteRule | null {
	const s = r.spec;
	if (r.paused || s.then !== 'enchufe' || !s.plug || s.plug.pause !== undefined) return null;
	// Done already, once: nothing left to do.
	if (s.once && r.lastFiredAt) return null;
	const target = plugs.find((p) => p.id === s.plug!.plugId);
	if (!target?.deviceId || target.satelliteFp !== fp) return null;
	const minutes =
		s.plug.minutes === null ? null : Math.min(Math.round(s.plug.minutes), MAX_PLUG_MIN);
	const base = {
		id: r.id,
		plug: target.deviceId,
		on: s.plug.on,
		minutes,
		once: s.once,
		...(s.conditions.length ? { asked: true as const } : {})
	};
	const asked = { ...base, asked: true as const, when: { kind: 'seilide' as const } };
	const w = s.when;
	if (w.kind === 'cada_dia' && w.time) return { ...base, when: { kind: 'cada_dia', time: w.time } };
	if (w.kind === 'en_fecha' && w.day && w.time)
		return { ...base, when: { kind: 'en_fecha', day: w.day, time: w.time } };
	if (w.kind === 'enchufe') {
		// By its name or kind, as rule-check.ts's plugFits: all of them through this satellite.
		const watched = plugs.filter((p) => hasWords(w.words, `${p.name} ${PLUG_KINDS[p.kind].label}`));
		if (!watched.length || watched.some((p) => !p.deviceId || p.satelliteFp !== fp)) return asked;
		return {
			...base,
			when: {
				kind: 'enchufe',
				plugs: watched.map((p) => p.deviceId!),
				moment: w.plug ?? 'termina'
			}
		};
	}
	return asked;
}
