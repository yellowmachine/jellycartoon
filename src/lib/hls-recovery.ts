import type Hls from 'hls.js';

/** Tries before saying it cannot be played, each a little later than the one before. */
export const TRIES = 5;
export const retryDelay = (tries: number) => tries * 2000;

export const RETRYING = 'Sin señal. Reintentando…';
export const GAVE_UP = 'No se puede reproducir ahora. Vuelve a intentarlo más tarde.';

/**
 * Fatal errors of hls.js, recovered from as its docs say: the network, loading again; the media,
 * `recoverMediaError()`. https://github.com/video-dev/hls.js/blob/master/docs/API.md#fatal-error-recovery
 * `problem` gets what to tell the user, and `null` once it plays again. Without this a channel off
 * the air, or a server restarting, leaves the player black and silent for good.
 */
export function recoverFromErrors(
	hls: Hls,
	HlsClass: typeof Hls,
	problem: (text: string | null) => void
) {
	const manifestErrors: string[] = [
		HlsClass.ErrorDetails.MANIFEST_LOAD_ERROR,
		HlsClass.ErrorDetails.MANIFEST_LOAD_TIMEOUT,
		HlsClass.ErrorDetails.MANIFEST_PARSING_ERROR
	];
	let tries = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	hls.on(HlsClass.Events.ERROR, (_event, data) => {
		if (!data.fatal) return;
		clearTimeout(timer);
		const recoverable =
			data.type === HlsClass.ErrorTypes.NETWORK_ERROR ||
			data.type === HlsClass.ErrorTypes.MEDIA_ERROR;
		if (!recoverable || tries >= TRIES) return problem(GAVE_UP);
		tries++;
		problem(RETRYING);
		timer = setTimeout(() => {
			if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
			// Without its playlist there is nothing to go on loading: asked for again.
			else if (manifestErrors.includes(data.details) && hls.url) hls.loadSource(hls.url);
			else hls.startLoad();
		}, retryDelay(tries));
	});
	// Playing again: what was said goes, and the next failure has all its tries.
	hls.on(HlsClass.Events.FRAG_BUFFERED, () => {
		if (!tries) return;
		tries = 0;
		problem(null);
	});
	hls.on(HlsClass.Events.DESTROYING, () => clearTimeout(timer));
}
