import { and, eq, isNotNull } from 'drizzle-orm';
import { voiceSatellite } from '#lib/server/db/schema.ts';
import { houseKitchen } from '#lib/server/fridge.ts';
import type { SatelliteRule } from 'comun/plug-rules.ts';

/**
 * The family's rules a satellite does itself (#651, phase 3): those in the list it says it keeps
 * (its beat), so Seilide does not do them too. Only once it has taken them: until then, Seilide.
 * Not a fallback for a satellite that is down: its plugs go through it, so Seilide could not either.
 * Those `asked` (phase 4) Seilide still looks at, and asks the satellite to do: see `bySatellite`.
 */
export async function heldRuleIds(familyId: string) {
	const rows = await houseKitchen(familyId).run((tx) =>
		tx
			.select({ offered: voiceSatellite.plugRules, kept: voiceSatellite.plugRulesKept })
			.from(voiceSatellite)
			.where(and(eq(voiceSatellite.familyId, familyId), isNotNull(voiceSatellite.plugRules)))
	);
	const held = new Map<number, SatelliteRule>();
	for (const { offered, kept } of rows)
		if (offered && kept >= offered.version) for (const r of offered.rules) held.set(r.id, r);
	return held;
}

/** Done by the satellite by itself, at its moment: Seilide does not look at it. */
export const bySatellite = (held: Map<number, SatelliteRule>, id: number) => {
	const r = held.get(id);
	return !!r && !r.asked;
};
