import { stillThere } from 'comun/still-there.svelte.ts';

/**
 * «¿Sigues ahí?» (#77) in Seilide: comun's, telling the house (through this server) of each touch
 * (at most every 30 s) and of the question, for /infantil's «Ahora» and «Última interacción».
 */

export type StillThereState = 'here' | 'asking' | 'answered' | 'stopped';

export function tellStillThere(state: StillThereState) {
	void fetch('/api/series/sigues-ahi', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ state })
	}).catch(() => {});
}

stillThere.onTouch = () => tellStillThere('here');

export { stillThere };
