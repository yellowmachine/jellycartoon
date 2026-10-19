import type { PageServerLoad } from './$types';
import { continueListening, userPodcasts } from '#lib/server/podcasts/podcasts.ts';

/** The ones this user follows, and what they left halfway. Following new ones is from the phone. */
export const load: PageServerLoad = async ({ locals }) => {
	const [podcasts, inProgress] = await Promise.all([
		userPodcasts(locals.user!.id),
		continueListening(locals.user!.id)
	]);
	return { podcasts, inProgress };
};
