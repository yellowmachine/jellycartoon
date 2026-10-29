import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';

/**
 * The AI's costs to the cloud (#193): kept when it does not get them, sent again with the next one
 * that gets there. On a real Postgres (PGlite, in memory) with the table's migration as it is.
 */
const db = drizzle(new PGlite(), { schema });
await db.execute(
	sql.raw(readFileSync(`${import.meta.dir}/../../../drizzle/0108_early_tomas.sql`, 'utf8'))
);

class CloudProblem extends Error {}
/** What the cloud got, and whether it is there. */
let received: { id: string; label: string }[] = [];
let up = true;
mock.module('#lib/server/db/index.ts', () => ({ db }));
mock.module('#lib/server/kitchen.ts', () => ({
	CloudProblem,
	cloudLink: async () => ({ url: 'https://nube.example', key: 'k' }),
	askCloud: async (
		_link: unknown,
		_path: string,
		{ body }: { body: { id: string; label: string } }
	) => {
		if (!up) throw new CloudProblem('No llego a la nube: sin internet, o la nube no contesta');
		received.push(body);
		return { ok: true };
	}
}));
const { tellCloud, unsentAiCosts, resendUnsent, forgetUnsent } =
	await import('./cloud-ai-costs.ts');

/** Until the resending that a good one starts in the background is done. */
const settled = () => resendUnsent();

beforeEach(async () => {
	await db.delete(schema.unsentAiCost);
	received = [];
	up = true;
});

describe('AI costs to the cloud', () => {
	test('one that gets there is not kept', async () => {
		await tellCloud('Voz', 0.01);
		await settled();
		expect(received.map((c) => c.label)).toEqual(['Voz']);
		expect(await unsentAiCosts()).toHaveLength(0);
	});

	test('one that does not is kept, with why', async () => {
		up = false;
		await tellCloud('Voz', 0.01);
		await tellCloud('Tickets', 0.02);
		const kept = await unsentAiCosts();
		expect(kept.map((c) => c.label)).toEqual(['Voz', 'Tickets']);
		expect(kept[0]!.error).toContain('No llego a la nube');
	});

	test('the next one that gets there takes the kept ones, with their own ids', async () => {
		up = false;
		await tellCloud('Voz', 0.01);
		const [kept] = await unsentAiCosts();
		up = true;
		await tellCloud('Tickets', 0.02);
		await settled();
		expect(received.map((c) => c.label)).toEqual(['Tickets', 'Voz']);
		expect(received[1]!.id).toBe(kept!.id);
		expect(await unsentAiCosts()).toHaveLength(0);
	});

	test('resending stops at the first that fails, and counts the try', async () => {
		up = false;
		await tellCloud('Voz', 0.01);
		await tellCloud('Tickets', 0.02);
		const result = await resendUnsent();
		expect(result).toMatchObject({ sent: 0, left: 2 });
		const kept = await unsentAiCosts();
		// One try more for the one it stopped at, not for the rest.
		expect(kept.map((c) => c.tries).sort()).toEqual([1, 2]);
		up = true;
		expect(await resendUnsent()).toEqual({ sent: 2, left: 0 });
	});

	test('one forgotten is not sent', async () => {
		up = false;
		await tellCloud('Voz', 0.01);
		const [kept] = await unsentAiCosts();
		await forgetUnsent(kept!.id);
		up = true;
		await resendUnsent();
		expect(received).toHaveLength(0);
	});
});
