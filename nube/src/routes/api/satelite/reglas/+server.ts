import { error } from '@sveltejs/kit';
import type { RuleDone } from 'comun/plug-rules.ts';
import type { RequestHandler } from './$types';
import { offeredRulesOf, offerDoneErrands } from '#lib/server/plugs/satellite-rules.ts';
import { satelliteDid } from '#lib/server/rules.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';

/** A satellite offline for days tells this many at most at once (its box keeps 200). */
const MAX_DONE = 200;

const doneOf = (v: unknown): RuleDone | null => {
	if (typeof v !== 'object' || v === null) return null;
	const d = v as Record<string, unknown>;
	if (!Number.isSafeInteger(d.id) || typeof d.key !== 'string' || d.key.length > 40) return null;
	if (typeof d.at !== 'number' || !Number.isFinite(d.at)) return null;
	if (d.failed !== undefined && (typeof d.failed !== 'string' || d.failed.length > 200))
		return null;
	if (d.missed !== undefined && typeof d.missed !== 'boolean') return null;
	return {
		id: d.id as number,
		key: d.key,
		at: d.at,
		...(d.failed ? { failed: d.failed as string } : {}),
		...(d.missed ? { missed: true } : {})
	};
};

/**
 * What a satellite's plug rules did, or why not (#651, phase 3), as it tells it, also late (it was
 * without internet): kept and told as Seilide does with its own (rules.ts, `satelliteDid`). Only
 * rules in the list it was offered. Then, an errand done goes out of its list without a signature
 * (it only takes that if it did it itself).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	const body = (await request.json().catch(() => null)) as { done?: unknown } | null;
	if (!Array.isArray(body?.done) || body.done.length > MAX_DONE) error(400, 'Sin sentido');
	const offered = new Set((await offeredRulesOf(k, satellite.id))?.rules.map((r) => r.id) ?? []);
	for (const raw of body.done) {
		const d = doneOf(raw);
		if (d && offered.has(d.id)) await satelliteDid(k, satellite.name, d);
	}
	await offerDoneErrands(k.familyId, satellite.id);
	return new Response(null, { status: 204 });
};
