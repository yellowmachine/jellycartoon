import { eq } from 'drizzle-orm';
import { daysToWarn, KEY_LIMIT, keyRefused, watchBlocks } from '#lib/server/ai-block.ts';
import { keyLimit } from '#lib/server/ai-spend.ts';
import { familyMember } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { familyOfKey, keepBlock, openRouterKey } from '#lib/server/family-settings.ts';
import { houseKitchen } from '#lib/server/fridge.ts';
import { tell } from '#lib/server/inbox.ts';

/**
 * A family's AI stopped or going again (ai-block.ts): kept in its settings, for a restart and the
 * banner, and, stopped, told to who runs the family, in their inbox and on their phones. From the
 * server's start (hooks.server.ts), as the costs.
 */
export const keepBlocks = () =>
	watchBlocks((apiKey, block) => {
		const familyId = familyOfKey(apiKey);
		if (!familyId) return;
		void (async () => {
			try {
				await keepBlock(houseKitchen(familyId), block);
			} catch (error) {
				console.error('[ia] No se pudo guardar si la IA está parada', error);
			}
			if (!block) return;
			await tell(familyId, await adminsOf(familyId), {
				kind: 'ia',
				title: 'La IA de la familia se ha parado',
				body: keyRefused(block.why)
					? `${block.why}. Hasta entonces no funcionan la voz, el DJ ni los tickets.`
					: block.why === KEY_LIMIT
						? `${block.why}. No funcionan la voz, el DJ ni los tickets hasta que se suba en openrouter.ai/keys y se pulse «Ya lo he subido», o se reinicie el límite.`
						: `${block.why}. No funcionan la voz, el DJ ni los tickets hasta que se recargue en openrouter.ai y se pulse «Ya he recargado».`,
				tag: `ia-parada-${familyId}`,
				url: keyRefused(block.why) ? '/ajustes?seccion=conexiones#ia' : '/',
				ttl: 24 * 60 * 60
			});
		})();
	});

const adminsOf = async (familyId: string) => {
	const admins = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(eq(familyMember.role, 'admin'))
	).catch(() => []);
	return admins.map((a) => a.id);
};

/**
 * The family's key about to expire (its date in OpenRouter), told to who runs the family before
 * the AI stops, on the days `daysToWarn` says. Once a day, from the scheduler.
 */
export async function warnKeyExpiring(familyId: string) {
	const key = await openRouterKey(houseKitchen(familyId));
	if (!key) return;
	const days = daysToWarn((await keyLimit(key))?.expiresAt);
	if (days === null) return;
	await tell(familyId, await adminsOf(familyId), {
		kind: 'ia',
		title: 'La clave de OpenRouter va a caducar',
		body: `${days === 1 ? 'Le queda menos de un día' : `Le quedan ${days} días`}. Cuando caduque no funcionarán la voz, el DJ ni los tickets: pon otra en Ajustes con «Conectar con OpenRouter».`,
		tag: `ia-caduca-${familyId}`,
		url: '/ajustes?seccion=conexiones#ia',
		ttl: 24 * 60 * 60
	});
}
