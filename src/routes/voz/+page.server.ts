import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';

export const load: PageServerLoad = () => {
	if (!voiceEnabled) error(404, 'No hay voz configurada (WHISPER_URL)');
};
