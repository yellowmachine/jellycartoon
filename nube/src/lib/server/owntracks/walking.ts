import { walkingOutings } from '#lib/owntracks-walking.ts';
import { owntracks } from './owntracks.ts';

/**
 * A person's outings walking by OwnTracks (#593, phase 2) between two moments, without what
 * overlaps their walks in the app (owntracks-walking.ts). Worked out each time from the
 * positions: nothing else to keep in step when one is deleted.
 */
export async function owntracksOutings(
	userId: string,
	from: Date,
	to: Date,
	appWalks: { startedAt: Date; endedAt: Date }[]
) {
	return walkingOutings(await owntracks.between(userId, from, to), appWalks);
}
