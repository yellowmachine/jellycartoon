import type { PageServerLoad } from './$types';
import { podcastLists } from '#lib/server/podcasts.ts';

/**
 * The ones this user follows, and what they left halfway, from the family's cloud (#253). Following
 * new ones is from the phone, in the cloud's Radio.
 */
export const load: PageServerLoad = async ({ locals }) => podcastLists(locals.user!.id);
