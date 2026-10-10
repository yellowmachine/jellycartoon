import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';

function body(path: string, start: number, end: number): BodyInit {
	return Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
}

/**
 * Serves a file with HTTP Range support, which `<video>` needs to seek, and answers 304 when the
 * browser's copy is still current.
 */
export async function fileResponse(
	request: Request,
	path: string,
	contentType: string,
	cacheControl = 'private, max-age=3600'
) {
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) error(404, 'Not found');

	const size = info.size;
	const headers = new Headers({
		'Content-Type': contentType,
		'Accept-Ranges': 'bytes',
		'Last-Modified': info.mtime.toUTCString(),
		'Cache-Control': cacheControl
	});

	// Last-Modified has whole seconds only.
	const since = Date.parse(request.headers.get('if-modified-since') ?? '');
	if (since && Math.floor(info.mtimeMs / 1000) * 1000 <= since) {
		return new Response(null, { status: 304, headers });
	}

	const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
	if (!range || (!range[1] && !range[2])) {
		headers.set('Content-Length', String(size));
		return new Response(request.method === 'HEAD' ? null : body(path, 0, size - 1), { headers });
	}

	let start: number;
	let end: number;
	if (range[1]) {
		start = Number(range[1]);
		end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
	} else {
		start = Math.max(0, size - Number(range[2]));
		end = size - 1;
	}

	if (start >= size || start > end) {
		headers.set('Content-Range', `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}

	headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
	headers.set('Content-Length', String(end - start + 1));
	return new Response(request.method === 'HEAD' ? null : body(path, start, end), {
		status: 206,
		headers
	});
}
