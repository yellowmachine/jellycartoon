import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { autoSubtitleLanguages, setAutoSubtitleLanguages } from '#lib/server/app-settings.ts';
import { KNOWN_LANGUAGES, languageLabel } from '#lib/languages.ts';
import {
	cancelAllQueued,
	cancelJob,
	dismissJob,
	moveJobFirst,
	pauseSubtitles,
	resumeSubtitles,
	retryJob,
	subtitleQueue
} from '#lib/server/auto-subtitles.ts';

/** Gestión → Subtítulos: the subtitles Whisper makes, all of them in one place. */
export const load: PageServerLoad = async () => ({
	queue: await subtitleQueue(),
	/** New episodes and films get them in these audio languages, once converted or catalogued. */
	autoLangs: await autoSubtitleLanguages(),
	knownLanguages: KNOWN_LANGUAGES.map((lang) => ({ lang, label: languageLabel(lang) }))
});

/** The job a button is about. */
async function jobId(request: Request) {
	const id = Number((await request.formData()).get('id'));
	return Number.isInteger(id) ? id : null;
}

/** One that takes a job, or says it is not one. */
const onJob =
	(act: (id: number) => Promise<void>) =>
	async ({ request }: { request: Request }) => {
		const id = await jobId(request);
		if (id === null) return fail(400, { message: 'Trabajo no válido' });
		await act(id);
	};

export const actions: Actions = {
	pause: async () => pauseSubtitles(),
	resume: async () => resumeSubtitles(),
	cancelAll: async () => cancelAllQueued(),
	cancel: onJob(cancelJob),
	first: onJob(moveJobFirst),
	retry: onJob(retryJob),
	dismiss: onJob(dismissJob),
	autoLangs: async ({ request }) => {
		const chosen = (await request.formData()).getAll('lang').map(String);
		await setAutoSubtitleLanguages(KNOWN_LANGUAGES.filter((l) => chosen.includes(l)));
		return { autoSaved: true };
	}
};
