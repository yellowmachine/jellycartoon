import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { formVtt, isAutoFile, readPhrases } from '#lib/server/auto-subtitle-files.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { SUBTITLE_FORMS, type SubtitleForm } from '#lib/server/voice/whisper-cues.ts';

const CONTENT_TYPES: Record<string, string> = {
	'.m3u8': 'application/vnd.apple.mpegurl',
	'.m4s': 'video/iso.segment',
	'.mp4': 'video/mp4',
	'.vtt': 'text/vtt; charset=utf-8'
};

export const GET: RequestHandler = async ({ params, request, url }) => {
	const type = CONTENT_TYPES[path.extname(params.file)];
	// Only plain names inside the episode folder, e.g. `master.m3u8` or `a0/seg_00001.m4s`.
	if (!type || !/^(?:[\w-]+\/)?[\w.-]+$/.test(params.file) || params.file.includes('..')) {
		error(404, 'Not found');
	}
	// Whisper's in the form chosen in «⚙ Estilo» (#86), made from their phrases.
	const form = url.searchParams.get('forma');
	if (isAutoFile(params.file) && SUBTITLE_FORMS.includes(form as SubtitleForm)) {
		const dir = hlsDir(Number(params.id));
		const phrases = await readPhrases(dir, params.file).catch(() => null);
		if (!phrases) error(404, 'Not found');
		return new Response(formVtt(phrases, form as SubtitleForm), {
			headers: { 'Content-Type': type, 'Cache-Control': 'private, no-cache' }
		});
	}
	// Subtitles are made again (Whisper's, #86) and an episode can be converted again: asked each
	// time whether they changed, a 304 if not. The video's pieces, kept an hour.
	const changes = params.file.endsWith('.vtt') || params.file.endsWith('.m3u8');
	return fileResponse(
		request,
		path.join(hlsDir(Number(params.id)), params.file),
		type,
		changes ? 'private, no-cache' : undefined
	);
};
