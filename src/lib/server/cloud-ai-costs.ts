import { asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { unsentAiCost } from '#lib/server/db/schema.ts';
import { askCloud, CloudProblem, cloudLink, type CloudLink } from '#lib/server/kitchen.ts';

/**
 * Each request's cost, to the family's cloud too, where Gastos → IA sums them with its own (#193).
 * One the cloud does not get is kept (unsent_ai_cost), and goes again with the next one that gets
 * there, or from Gestión → Nube. Its id goes with it: the cloud never counts one twice, even if it
 * got it and only its answer was lost. Without the cloud connected there is nowhere to send them,
 * and the Registro keeps them.
 */

interface Cost {
	id: string;
	label: string;
	cost: number;
	at: Date;
}

const why = (error: unknown) =>
	error instanceof CloudProblem ? error.message : 'La nube no contestó como se esperaba';

const send = (link: CloudLink, c: Cost) =>
	askCloud(link, '/gasto-ia', {
		body: { id: c.id, label: c.label, cost: c.cost, at: c.at.toISOString() }
	});

/** A request's cost, just spent. Never in the way of what it was for. */
export async function tellCloud(label: string, cost: number) {
	const link = await cloudLink().catch(() => null);
	if (!link) return;
	const c = { id: crypto.randomUUID(), label, cost, at: new Date() };
	try {
		await send(link, c);
	} catch (error) {
		await db
			.insert(unsentAiCost)
			.values({ ...c, error: why(error) })
			.catch((e) => console.warn('[ia] No se pudo guardar el coste sin mandar', String(e)));
		return;
	}
	void resendUnsent().catch((e) => console.warn('[ia] No se pudieron reenviar', String(e)));
}

/** The one resending, so two at once do not send the same ones. */
let resending: Promise<{ sent: number; left: number; error?: string }> | null = null;

/**
 * The kept ones, oldest first, until one fails (the cloud is likely not there: the rest wait too).
 * What was sent, what is left and, if it stopped, why.
 */
export function resendUnsent() {
	resending ??= (async () => {
		const link = await cloudLink();
		const pending = await db.select().from(unsentAiCost).orderBy(asc(unsentAiCost.at));
		if (!link)
			return {
				sent: 0,
				left: pending.length,
				error: 'La nube no está conectada: Ajustes → Casa → «La nube»'
			};
		let sent = 0;
		for (const c of pending) {
			try {
				await send(link, c);
			} catch (error) {
				await db
					.update(unsentAiCost)
					.set({ error: why(error), tries: sql`${unsentAiCost.tries} + 1`, triedAt: new Date() })
					.where(eq(unsentAiCost.id, c.id));
				return { sent, left: pending.length - sent, error: why(error) };
			}
			await db.delete(unsentAiCost).where(eq(unsentAiCost.id, c.id));
			sent++;
		}
		return { sent, left: 0 };
	})().finally(() => {
		resending = null;
	});
	return resending;
}

/** For Gestión → Nube. */
export const unsentAiCosts = () => db.select().from(unsentAiCost).orderBy(asc(unsentAiCost.at));

/** One not to send after all. */
export async function forgetUnsent(id: string) {
	await db.delete(unsentAiCost).where(eq(unsentAiCost.id, id));
}
