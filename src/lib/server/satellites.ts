import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';

/**
 * The voice satellites are Seilide's (#296, #329): a device in a room that hears its wake word and
 * talks to Seilide, which asks the house only for what it does (its music, the living room, its
 * Snapcast: /api/v1/voz/orden, /api/v1/voz, /api/v1/salon/bajar). The house serves none itself.
 */
export interface Satellite {
	id: string;
	name: string;
	/** In whose name what it does here goes: whoever manages the house (`cloudSatellite`). */
	ownerId: string;
	/** Its own snapclient on the house's Snapcast, if it has one: its «aquí». */
	speakerId: string | null;
	/** It plays the house's music itself (`speakerId`): «aquí» is only there. */
	ownSpeaker?: boolean;
}

/**
 * One that talks to Seilide (#296), as the house sees it: in the name of whoever manages the house
 * (its first account), and with its own snapclient as its room's speaker if Seilide says it has
 * one. Null without any account.
 */
export async function cloudSatellite(id: string, name: string, speaker: string | null) {
	const [owner] = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.orderBy(asc(user.createdAt))
		.limit(1);
	if (!owner) return null;
	const satellite: Satellite = {
		id,
		name,
		ownerId: owner.id,
		speakerId: speaker,
		ownSpeaker: speaker !== null
	};
	return { satellite, owner };
}
