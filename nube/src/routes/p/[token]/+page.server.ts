import type { PageServerLoad } from './$types';
import { sharedWalks } from '#lib/server/walks/shared.ts';
import { isPreviewBot, sharedHeading, sharedTitle } from '#lib/walk-share.ts';
import { walkDistanceText } from '#lib/walks.ts';

/**
 * A walk shared by link (#434), for whoever has it, without an account: as it is seen in Paseos,
 * without the hours of each point, its notes, nor, unless said, its ends near home. A link's
 * preview (WhatsApp) gets its title, never where; and is not counted as someone opening it.
 */
export const load: PageServerLoad = async ({ params, request, setHeaders }) => {
	setHeaders({
		'cache-control': 'no-store',
		'x-robots-tag': 'noindex, nofollow',
		'referrer-policy': 'no-referrer'
	});
	const walk = await sharedWalks.open(params.token, {
		counted: !isPreviewBot(request.headers.get('user-agent'))
	});
	return {
		walk,
		heading: walk ? sharedHeading(walk.name) : null,
		title: walk ? sharedTitle(walk.name, walkDistanceText(walk.distance)) : 'Paseo compartido'
	};
};
