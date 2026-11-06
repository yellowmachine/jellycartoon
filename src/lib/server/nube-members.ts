import { isAdmin } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { askCloud, cloudLink } from '#lib/server/kitchen.ts';
import { log } from '#lib/server/log.ts';
import { nube, NUBE_PROVIDER } from '#lib/server/nube-login.ts';
import { closeSessionsOfThoseNotIn } from '#lib/server/nube-members-scope.ts';
import { keepSeilideKids } from '#lib/server/seilide-kids.ts';

/**
 * Whoever enters the house with Seilide and is no longer in its family (#315: unlinked, gone, or
 * their account deleted) keeps no session here. Seilide does not let them in again, and they have
 * no password; a session already open would last its month. Asked, and not told: a house that was
 * off, or away from the internet, finds out when it can. Without an answer, nothing changes.
 *
 * The administrator of the house stays: they keep their password and the house is theirs, whatever
 * Seilide says. Who never entered with Seilide is not touched: the house's own people.
 */
const EVERY = 5 * 60_000;

async function closeSessionsOfGone() {
	if (!nube) return;
	const link = await cloudLink();
	if (!link) return;
	const { adults, kids } = await askCloud<{ adults?: unknown; kids?: unknown }>(link, '/personas');
	// A family always has someone: a list without anyone is not one to act on.
	if (Array.isArray(adults) && adults.length) await keepSeilideKids(kids);
	const closed = await closeSessionsOfThoseNotIn(db, adults, { provider: NUBE_PROVIDER, isAdmin });
	if (closed) log.info('nube', 'Sesiones cerradas de quien ya no está en la familia', { closed });
}

export function startClosingSessionsOfGone() {
	const run = () =>
		closeSessionsOfGone().catch((error) =>
			log.warn('nube', 'No se pudo mirar quién sigue en la familia', { error })
		);
	void run();
	setInterval(run, EVERY).unref();
}
