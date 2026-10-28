import type { PageServerLoad } from './$types';
import { stationsInfo } from '#lib/server/radio.ts';

export const load: PageServerLoad = async ({ parent }) => {
	const { cloud } = await parent();
	return {
		info: await stationsInfo(),
		/** The podcasts' tab: in the cloud (#253), or the page that says how to connect it. */
		podcasts: cloud ? `${cloud}/radio/podcasts` : '/radio/podcasts'
	};
};
