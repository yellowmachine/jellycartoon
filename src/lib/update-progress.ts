/**
 * Following an update (#20) from what /api/health answers every few seconds: which version, or
 * nothing while the app restarts. Pure, for UpdateProgress and its tests.
 */

/** Without even starting, it is not going to. */
export const START_LIMIT_MS = 5 * 60_000;
/** And nothing takes this long: a copy, a download, a restart. */
export const LIMIT_MS = 15 * 60_000;

export type Step =
	| { kind: 'wait'; stage: 'preparing' | 'restarting' }
	| { kind: 'done' }
	| { kind: 'failed'; message: string };

/**
 * `version`: what answered now, null if nothing did. `wentDown`: whether it has stopped answering
 * at some point since the update started.
 */
export function nextStep(
	version: string | null,
	{ target, wentDown, elapsedMs }: { target: string; wentDown: boolean; elapsedMs: number }
): Step {
	if (version === target) return { kind: 'done' };
	if (version !== null && wentDown)
		return {
			kind: 'failed',
			message: `No se ha podido instalar la ${target}: sigue la ${version}. WUD ha vuelto a la anterior porque la nueva no arrancó bien. Mira el Registro.`
		};
	if (version !== null && elapsedMs > START_LIMIT_MS)
		return {
			kind: 'failed',
			message: 'La actualización no ha empezado. Prueba un poco más tarde, o mira el Registro.'
		};
	if (elapsedMs > LIMIT_MS)
		return {
			kind: 'failed',
			message: 'La actualización está tardando demasiado. Mira el Registro.'
		};
	return { kind: 'wait', stage: version === null || wentDown ? 'restarting' : 'preparing' };
}
