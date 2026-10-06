import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { hlsDir } from '#lib/server/library/paths.ts';

const CONTENT_TYPES: Record<string, string> = {
	'.m3u8': 'application/vnd.apple.mpegurl',
	'.m4s': 'video/iso.segment',
	'.mp4': 'video/mp4',
	'.vtt': 'text/vtt; charset=utf-8'
};

export const GET: RequestHandler = ({ params, request }) => {
	const type = CONTENT_TYPES[path.extname(params.file)];
	// Only plain names inside the episode folder, e.g. `master.m3u8` or `a0/seg_00001.m4s`.
	if (!type || !/^(?:[\w-]+\/)?[\w.-]+$/.test(params.file) || params.file.includes('..')) {
		error(404, 'Not found');
	}
	return fileResponse(request, path.join(hlsDir(Number(params.id)), params.file), type);
};
