import { addDays } from 'comun/agenda.ts';
import { familyMember } from '../db/schema.ts';
import { asFamily } from '../family.ts';
import { dayOf, kitchenOf, today } from '../fridge.ts';
import { dayStart } from '../plugs/stats.ts';
import { listWalks } from '../walks/walks.ts';
import { KEEP_DAYS } from '#lib/owntracks.ts';
import { owntracks } from './owntracks.ts';

/** The first day whose positions are still kept: KEEP_DAYS back from today, today included. */
export const firstKeptDay = (now = today()) => addDays(now, -(KEEP_DAYS - 1));

/**
 * OwnTracks (#593, phase 3), every night, for each person of a family: the positions of over
 * KEEP_DAYS days ago summed up by day and forgotten (owntracks-scope.ts). The family only says
 * who its people are; each one's positions are read as them.
 */
export async function summarizeOldPositions(familyId: string) {
	const people = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember)
	);
	const firstKept = firstKeptDay();
	for (const { id } of people)
		await owntracks.summarizeOld(id, firstKept, {
			dayStart,
			dayOf,
			nextDay: (day) => addDays(day, 1),
			appWalks: () => kitchenOf(id).then((k) => listWalks(k, 1000))
		});
}
