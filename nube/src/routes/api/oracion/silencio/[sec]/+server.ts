import { error } from '@sveltejs/kit';
import { writeWav } from 'comun/wav.ts';
import type { RequestHandler } from './$types';
import { MAX_PAUSE } from '#lib/prayers.ts';

/**
 * The pause between a list's texts (#339), as one more in the player's queue: that many seconds of
 * silence, a small WAV (8 kHz, mono), the same for everyone.
 */
const RATE = 8000;

export const GET: RequestHandler = ({ params }) => {
	const sec = Number(params.sec);
	if (!Number.isInteger(sec) || sec < 1 || sec > MAX_PAUSE) error(404, 'No encontrado');
	return new Response(writeWav(RATE, 1, new Uint8Array(RATE * sec * 2)), {
		headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=31536000, immutable' }
	});
};
