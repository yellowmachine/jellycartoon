import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { parseVoiceLevels, type VoiceLevels } from '#lib/voice-levels.ts';

/** The satellites' voice louder, and the music lower under it (#223): Ajustes → Casa. */
export async function getVoiceLevels() {
	try {
		return parseVoiceLevels(JSON.parse((await getAppSetting('voice_levels')) ?? 'null'));
	} catch {
		return parseVoiceLevels(null);
	}
}

export async function setVoiceLevels(levels: VoiceLevels) {
	await setAppSetting('voice_levels', JSON.stringify(parseVoiceLevels(levels)));
}
