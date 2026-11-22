import { asc, eq } from 'drizzle-orm';
import { fold } from 'comun/music.ts';
import { savedPlace } from '../db/schema.ts';
import { familyPlace } from '../family-settings.ts';
import type { Kitchen } from '../fridge.ts';
import type { OwntracksRegion } from '#lib/owntracks.ts';

/**
 * A person's places for OwnTracks (#593, phase 4): Casa, Ajustes → Dónde vivís when it is the
 * house's own point (`exact`, not the town's centre), and their places saved in Viajes. A saved
 * place called «Casa» goes instead of the family's.
 */
export async function owntracksRegions(k: Kitchen) {
	const userId = k.userId;
	const [home, saved] = await Promise.all([
		familyPlace(k),
		// Read here, not by trips/places.ts: what it needs for routes is not needed for this.
		userId
			? k.run((tx) =>
					tx
						.select({
							id: savedPlace.id,
							name: savedPlace.name,
							lat: savedPlace.lat,
							lon: savedPlace.lon
						})
						.from(savedPlace)
						.where(eq(savedPlace.userId, userId))
						.orderBy(asc(savedPlace.name))
				)
			: []
	]);
	const regions: OwntracksRegion[] = saved.map((p) => ({
		rid: `sitio-${p.id}`,
		desc: p.name,
		lat: p.lat,
		lon: p.lon
	}));
	const homeSaved = regions.some((r) => fold(r.desc) === 'casa');
	if (home?.exact && !homeSaved)
		regions.unshift({ rid: 'casa', desc: 'Casa', lat: home.lat, lon: home.lon });
	return {
		regions,
		/** Dónde vivís, only a town: Casa is left out until «Usar mi ubicación» at home. */
		homeInexact: !!home && !home.exact && !homeSaved
	};
}

/** Their names, for the AI that understands rules. */
export const owntracksPlaceNames = async (k: Kitchen) =>
	(await owntracksRegions(k)).regions.map((r) => r.desc);
