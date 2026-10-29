import { eq } from 'drizzle-orm';
import { familyMember } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { notify } from '#lib/server/push.ts';
import { voiceAlarm, type VoiceNotice } from './alarm-rules.ts';
import { FALLBACK_VOICE_MODEL } from './settings.ts';

/**
 * The voice watching itself: its family's administrators told on their phones when it keeps
 * failing, or when the fallback model answers in place of theirs (alarm-rules.ts), so that they
 * know before someone at home finds it out. Kept while the server runs.
 */
const alarm = voiceAlarm();

const detailOf = (error: unknown) =>
	(error instanceof Error ? error.message : String(error)).slice(0, 200);

async function tell(familyId: string, notice: VoiceNotice) {
	const admins = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(eq(familyMember.role, 'admin'))
	);
	console.warn(`[voz] Aviso a quien administra: ${notice.kind}`, {
		familyId,
		detail: notice.detail
	});
	await notify(
		familyId,
		admins.map((a) => a.id),
		notice.kind === 'failing'
			? {
					title: 'La voz está fallando',
					body: `No ha podido con las últimas órdenes: ${notice.detail}`,
					tag: 'voz-falla',
					url: '/ajustes',
					ttl: 3600
				}
			: {
					title: 'La voz va con el modelo de reserva',
					body: `El modelo de la voz no contesta (${notice.detail}); mientras, contesta ${FALLBACK_VOICE_MODEL}. Se cambia en Ajustes.`,
					tag: 'voz-reserva',
					url: '/ajustes',
					ttl: 24 * 3600
				}
	);
}

const told = (familyId: string, notice: VoiceNotice | null) => {
	if (notice)
		void tell(familyId, notice).catch((error) =>
			console.warn('[voz] No se pudo avisar de que falla', { familyId, error: String(error) })
		);
};

/** An order answered. */
export const voiceAnswered = (familyId: string) => alarm.ok(familyId);
/** An order not answered. */
export const voiceFailed = (familyId: string, error: unknown) =>
	told(familyId, alarm.failed(familyId, detailOf(error)));
/** Answered by the fallback model, and why. */
export const voiceFellBack = (familyId: string, why: string) =>
	told(familyId, alarm.fellBack(familyId, why.slice(0, 200)));
