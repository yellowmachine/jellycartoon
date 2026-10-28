import type { Guidance } from 'comun/road-guide.ts';

/**
 * What to say aloud while guiding (#78, phase 3d), and when: each maneuver once well before it
 * («En 300 metros, gira a la izquierda por Calle Real») and once at it, both by the time it takes
 * to get there at the speed we go; and the arrival. `said` has what was said of this route.
 */

/** Well before: ~20 s ahead, and never closer than 250 m. */
export const farMetres = (speed: number | null) => Math.max(250, (speed ?? 0) * 20);
/** At it: ~5 s ahead, and never closer than 40 m. */
export const nearMetres = (speed: number | null) => Math.max(40, (speed ?? 0) * 5);

/** «300 metros», «1,5 kilómetros»: rounded, as it is said. */
export function spokenDistance(metres: number) {
	if (metres >= 1000) {
		const km = Math.round(metres / 100) / 10;
		return `${km.toLocaleString('es-ES')} ${km === 1 ? 'kilómetro' : 'kilómetros'}`;
	}
	return `${Math.max(50, Math.round(metres / 50) * 50)} metros`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** openrouteservice's «straight on»: nothing to do, so not said (it is shown). */
const STRAIGHT = 6;
/** Its arrival: said before it («En 250 metros, llegas a…»); at it, «Has llegado». */
const ARRIVAL = 10;

/** The next thing to say and its key (to say it once), or null. */
export function toSay(
	g: Guidance,
	speed: number | null,
	said: ReadonlySet<string>
): { key: string; text: string } | null {
	if (g.arrived)
		return said.has('arrived') ? null : { key: 'arrived', text: 'Has llegado a tu destino' };
	if (!g.next || g.next.type === STRAIGHT) return null;
	const near = `near:${g.nextIndex}`;
	const far = `far:${g.nextIndex}`;
	if (said.has(near)) return null;
	if (g.toNext <= nearMetres(speed))
		return g.next.type === ARRIVAL ? null : { key: near, text: g.next.instruction };
	if (said.has(far) || g.toNext > farMetres(speed)) return null;
	return {
		key: far,
		text: `En ${spokenDistance(g.toNext)}, ${lowerFirst(g.next.instruction)}`
	};
}
