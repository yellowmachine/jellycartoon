import { auth } from '#lib/server/auth.ts';
import { usableDiscovery } from '#lib/seilide-account.ts';
import { log } from '#lib/server/log.ts';
import { nube, NUBE_PROVIDER, nubeDiscoveryUrl } from '#lib/server/nube-login.ts';

/**
 * «Entrar con Seilide» when the house started without reaching it (#279): Better Auth asks Seilide
 * for its addresses only at the start, and without an answer it does not know this way in until it
 * starts again. So the house looks every minute, and once Seilide answers, /login offers to restart
 * it. By someone's click, not by itself: it cuts whatever is under way.
 */
const EVERY = 60_000;

let back = false;
let restarting = false;

/** Seilide answers again, and the house needs a restart to enter with it. */
export const seilideIsBack = () => back;

async function seilideAnswers(url: string) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		return res.ok && usableDiscovery(await res.json());
	} catch {
		return false;
	}
}

export async function startWatchingSeilide() {
	if (!nube) return;
	const { socialProviders } = await auth.$context;
	if (socialProviders.some((p) => p.id === NUBE_PROVIDER)) return;
	log.warn('nube', 'La casa ha arrancado sin llegar a Seilide: se mira cada minuto');
	const url = nubeDiscoveryUrl(nube.url);
	const timer = setInterval(async () => {
		if (!(await seilideAnswers(url))) return;
		clearInterval(timer);
		back = true;
		log.info('nube', 'Seilide ya responde: falta reiniciar la casa para entrar con él');
	}, EVERY);
	timer.unref();
}

/**
 * The house, down and up again by Docker's `restart: unless-stopped`: its own SIGTERM, as when
 * Docker stops it (hooks.server.ts). Only once Seilide answers, so nobody can restart it otherwise,
 * and after a moment, for the answer to get to the browser.
 */
export function restartForSeilide() {
	if (!back) return false;
	if (!restarting) {
		restarting = true;
		log.info('nube', 'Reinicio pedido desde /login para entrar con Seilide');
		setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500);
	}
	return true;
}
