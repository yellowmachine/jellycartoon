import type { PageServerLoad } from './$types';
import { TOKEN } from '#lib/server/trips/share-store.ts';
import { trips } from '#lib/server/trips/share.ts';

/**
 * A shared trip (#81), for whoever has its link, without an account: whose it is, for its title (a
 * link's preview in WhatsApp shows it), never where. The rest comes live (./eventos).
 */
export const load: PageServerLoad = ({ params, setHeaders }) => {
	setHeaders({
		'cache-control': 'no-store',
		'x-robots-tag': 'noindex, nofollow',
		'referrer-policy': 'no-referrer'
	});
	const trip = TOKEN.test(params.token) ? trips.get(params.token) : null;
	return {
		title: trip && !trip.ended && trip.name ? `Viaje de ${trip.name}` : 'Viaje compartido'
	};
};
