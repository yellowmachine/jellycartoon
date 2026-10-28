import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { formVtt, isAutoFile, readPhrases } from '#lib/server/auto-subtitle-files.ts';
import { fileResponse } from 'comun/server/file-response.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { onlyLight } from '#lib/server/library/light-master.ts';
import { SUBTITLE_FORMS, type SubtitleForm } from '#lib/server/voice/whisper-cues.ts';

const CONTENT_TYPES: Record<string, string> = {
	'.m3u8': 'application/vnd.apple.mpegurl',
	'.m4s': 'video/iso.segment',
	'.mp4': 'video/mp4',
	'.vtt': 'text/vtt; charset=utf-8'
};

/**
 * A file of an episode's HLS: in the app (/api/hls) and in the video API (/api/v1/hls, #253).
 * `lightOnly`: its master playlist with only the light variant, when there is one.
 */
export async function hlsFile(
	request: Request,
	url: URL,
	episodeId: number,
	file: string,
	{ lightOnly = false } = {}
) {
	const type = CONTENT_TYPES[path.extname(file)];
	// Only plain names inside the episode folder, e.g. `master.m3u8` or `a0/seg_00001.m4s`.
	if (!type || !/^(?:[\w-]+\/)?[\w.-]+$/.test(file) || file.includes('..')) {
		error(404, 'Not found');
	}
	const dir = hlsDir(episodeId);
	// Whisper's in the form chosen in «⚙ Estilo» (#86), made from their phrases.
	const form = url.searchParams.get('forma');
	if (isAutoFile(file) && SUBTITLE_FORMS.includes(form as SubtitleForm)) {
		const phrases = await readPhrases(dir, file).catch(() => null);
		if (!phrases) error(404, 'Not found');
		return new Response(formVtt(phrases, form as SubtitleForm), {
			headers: { 'Content-Type': type, 'Cache-Control': 'private, no-cache' }
		});
	}
	if (lightOnly && file === 'master.m3u8') {
		const master = await readFile(path.join(dir, file), 'utf8').catch(() => null);
		if (master === null) error(404, 'Not found');
		return new Response(onlyLight(master), {
			headers: { 'Content-Type': type, 'Cache-Control': 'private, no-cache' }
		});
	}
	// Subtitles are made again (Whisper's, #86) and an episode can be converted again: asked each
	// time whether they changed, a 304 if not. The video's pieces, kept an hour.
	const changes = file.endsWith('.vtt') || file.endsWith('.m3u8');
	return fileResponse(
		request,
		path.join(dir, file),
		type,
		changes ? 'private, no-cache' : undefined
	);
}
