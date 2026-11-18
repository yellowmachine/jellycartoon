import { listAlarms } from './alarms/alarms.ts';
import { companionsFor } from './companion.ts';
import { fridgeState, kitchenOf } from './fridge.ts';
import { homeWeather } from './home.ts';
import { pendingDosesToday } from './medication.ts';
import { listPlugs } from './plugs/plugs.ts';
import { voiceSettings } from './voice/settings.ts';
import { myWalkPhotoIds } from './walks/walks.ts';
import { ringsToday } from 'comun/alarms.ts';

/**
 * The Vista's cards (#525): the house's screen, for everyone in the family, so nothing of one
 * person (Papeles, Dinero, their chat, their Buzón). Today's agenda with the house's alarms and
 * timers that ring today (not one person's, as a satellite sees them), the doses still to take,
 * the fridge, the plugs and «Compañía» when someone does not answer. The weather comes after the
 * page (Open-Meteo).
 */
export async function vistaOf(userId: string) {
	const k = await kitchenOf(userId);
	const [fridge, alarms, doses, plugs, companions, voice] = await Promise.all([
		fridgeState(k),
		listAlarms(k, null),
		pendingDosesToday(k),
		listPlugs(userId).catch((error) => {
			console.warn('[vista] Sin los enchufes', String(error));
			return [];
		}),
		companionsFor(userId).catch((error) => {
			console.warn('[vista] Sin Compañía', String(error));
			return [];
		}),
		voiceSettings(k)
	]);
	return {
		fridge,
		alarms: alarms.filter((a) => ringsToday(a)),
		doses,
		plugs: plugs.filter((p) => !p.waiting),
		/** Only who needs looking at: the rest is in Compañía. */
		alerts: companions.filter((c) => c.alert),
		/** The family's «Horas de silencio»: the Vista's night (vista-idle.ts), or its own hours. */
		night: voice.quiet,
		weather: homeWeather(k).catch(() => null)
	};
}

/**
 * The resting Vista's background (#525): photos of the walks of whoever's account the tablet is
 * open with (walks are private, so only theirs), and only if this device chose them.
 */
export const vistaPhotos = async (userId: string) => myWalkPhotoIds(await kitchenOf(userId));
