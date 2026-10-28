import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import { podcastLists } from '#lib/server/podcasts/podcasts.ts';
import { personOnly } from './person.ts';

/**
 * The family's podcasts for its house (#253): the ones the person asking follows, each with its
 * newest episode, and what they left halfway (the TV, the road mode). Following new ones is here.
 */
export const GET: RequestHandler = async ({ request }) =>
	json(await podcastLists(personOnly(await houseRequest(request))));
