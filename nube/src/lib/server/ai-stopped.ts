import { eq } from 'drizzle-orm';
import { BAD_KEY, KEY_LIMIT, watchBlocks } from '#lib/server/ai-block.ts';
import { familyMember } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { familyOfKey, keepBlock } from '#lib/server/family-settings.ts';
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
			const admins = await asFamily(familyId, (tx) =>
				tx
					.select({ id: familyMember.userId })
					.from(familyMember)
					.where(eq(familyMember.role, 'admin'))
			).catch(() => []);
			await tell(
				familyId,
				admins.map((a) => a.id),
				{
					kind: 'ia',
					title: 'La IA de la familia se ha parado',
					body:
						block.why === BAD_KEY
							? `${block.why}. Hasta entonces no funcionan la voz, el DJ ni los tickets.`
							: block.why === KEY_LIMIT
								? `${block.why}. No funcionan la voz, el DJ ni los tickets hasta que se suba en openrouter.ai/keys y se pulse «Ya lo he subido», o se reinicie el límite.`
								: `${block.why}. No funcionan la voz, el DJ ni los tickets hasta que se recargue en openrouter.ai y se pulse «Ya he recargado».`,
					tag: `ia-parada-${familyId}`,
					url: block.why === BAD_KEY ? '/ajustes?seccion=familia#ia' : '/',
					ttl: 24 * 60 * 60
				}
			);
		})();
	});
