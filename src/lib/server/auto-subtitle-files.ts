import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formCues, phrasesFromVtt, type SubtitleForm } from '#lib/server/voice/whisper-cues.ts';
import { parseVtt, serializeSrt, serializeVtt, type Cue } from '#lib/vtt.ts';

/**
 * Whisper's subtitles on disk (#86): their phrases (`sub_auto_<lang>.json`), and the .vtt in the
 * default form, for what reads it as it is. Each viewer's form (blocks, rolled up…) is made from
 * the phrases when asked for; those made before the phrases were kept get them back from the .vtt.
 */

/** The files of the made ones; a converted episode's own are `sub_N_lang.vtt`. */
export const AUTO_PREFIX = 'sub_auto_';
export const DEFAULT_FORM: SubtitleForm = 'blocks';

/** `sub_auto_eng.vtt`; not a form's beside it (`sub_auto_eng.rollup.vtt`). */
export const isAutoFile = (file: string) => /^sub_auto_[^.]+\.vtt$/.test(file);

const phrasesFile = (file: string) => file.replace(/\.vtt$/, '.json');

/** Its phrases: kept with it, or back from its .vtt. */
export async function readPhrases(dir: string, file: string): Promise<Cue[]> {
	const kept = await readFile(path.join(dir, phrasesFile(file)), 'utf8').catch(() => null);
	if (kept) return JSON.parse(kept) as Cue[];
	return phrasesFromVtt(parseVtt(await readFile(path.join(dir, file), 'utf8')));
}

/** In the form asked for, as a .vtt. */
export const formVtt = (phrases: Cue[], form: SubtitleForm) =>
	serializeVtt(formCues(phrases, form), { dim: form === 'rollupDim' });

/** Just made: its phrases, and the .vtt in the default form. */
export async function writeAutoSubtitles(dir: string, file: string, phrases: Cue[]) {
	await writeFile(path.join(dir, phrasesFile(file)), JSON.stringify(phrases));
	await writeFile(path.join(dir, file), formVtt(phrases, DEFAULT_FORM));
}

/**
 * The file of a form, beside it, for mpv, which reads them from disk (`sub_auto_eng.rollup.vtt`):
 * made again when the subtitles are newer. Its name. The dimmed one as .srt, whose colour mpv keeps.
 */
export async function formFile(dir: string, file: string, form: SubtitleForm) {
	if (form === DEFAULT_FORM && (await stat(path.join(dir, phrasesFile(file))).catch(() => null)))
		return file;
	const dim = form === 'rollupDim';
	const name = file.replace(/\.vtt$/, `.${form}.${dim ? 'srt' : 'vtt'}`);
	const [made, source] = await Promise.all([
		stat(path.join(dir, name)).catch(() => null),
		stat(path.join(dir, file)).catch(() => null)
	]);
	if (!made || !source || made.mtimeMs < source.mtimeMs)
		await writeFile(
			path.join(dir, name),
			dim
				? serializeSrt(formCues(await readPhrases(dir, file), form), { dim })
				: formVtt(await readPhrases(dir, file), form)
		);
	return name;
}

/** A subtitles file's cues as said, for Langua's clips: Whisper's, their phrases, once each. */
export async function readCues(dir: string, file: string) {
	return isAutoFile(file)
		? readPhrases(dir, file)
		: parseVtt(await readFile(path.join(dir, file), 'utf8'));
}
