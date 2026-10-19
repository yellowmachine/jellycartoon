import type { LngLat } from '#lib/road.ts';

/**
 * Photos from the road mode (#81): the back camera opened when asked (a button, or the voice), one
 * frame, and closed again; with when and where. Sent to the server at once, or, without signal,
 * when it comes back.
 */

/** The longest side: enough to see what it was, a few hundred KB. */
const MAX_SIDE = 1920;
const QUALITY = 0.82;
/** The camera just opened adjusts its light for a moment: the frame after it. */
const SETTLE_MS = 600;
/** Without an image by then, the camera is not working. */
const FIRST_FRAME_MS = 4000;
const RETRY_EVERY_MS = 30_000;

interface Waiting {
	jpeg: Blob;
	t: number;
	at: LngLat | null;
}

/** Where we are, if the GPS says it quickly; the photo does not wait for it. */
function position(): Promise<LngLat | null> {
	return new Promise((resolve) => {
		if (!('geolocation' in navigator)) return resolve(null);
		navigator.geolocation.getCurrentPosition(
			({ coords }) => resolve([coords.longitude, coords.latitude]),
			() => resolve(null),
			{ enableHighAccuracy: true, maximumAge: 10_000, timeout: 4000 }
		);
	});
}

/** One frame of the back camera, as a JPEG; the camera closed after it. */
async function frame(): Promise<Blob> {
	const stream = await navigator.mediaDevices.getUserMedia({
		video: {
			facingMode: { ideal: 'environment' },
			width: { ideal: 1920 },
			height: { ideal: 1080 }
		},
		audio: false
	});
	// In the page while it is taken, unseen: browsers stop a video that is not in it.
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
	document.body.append(video);
	try {
		video.srcObject = stream;
		await video.play();
		// Its first real frame (until then it is 0×0, or 2×2), and then a moment for its light.
		const started = Date.now();
		while (video.videoWidth <= 2 && Date.now() - started < FIRST_FRAME_MS)
			await new Promise((resolve) => setTimeout(resolve, 50));
		if (video.videoWidth <= 2) throw new Error('La cámara no da imagen');
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
		const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(video.videoWidth * scale);
		canvas.height = Math.round(video.videoHeight * scale);
		canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('Sin imagen'))),
				'image/jpeg',
				QUALITY
			)
		);
	} finally {
		for (const track of stream.getTracks()) track.stop();
		video.remove();
	}
}

/** How long the last photo stays shown once it is known whether it was kept. */
const SHOWN_MS = 3000;

class RoadPhotos {
	/** Taking one now. */
	busy = $state(false);
	/**
	 * The last one, for a moment: seen at once, to know whether it came out well (and take another),
	 * and then whether it was kept. Its image as an object URL.
	 */
	last = $state<{ url: string; state: 'sending' | 'saved' | 'waiting' } | null>(null);
	/** What went wrong, for a moment. */
	problem = $state<string | null>(null);
	/** Taken and not sent yet (no signal). */
	waiting = $state(0);

	#queue: Waiting[] = [];
	#retry: ReturnType<typeof setInterval> | undefined;

	/**
	 * A photo, gone from the screen in a moment (and its image let go), if it is still the one
	 * shown: another taken meanwhile has its own moment.
	 */
	#hideSoon(url: string | null) {
		setTimeout(() => {
			if (url) URL.revokeObjectURL(url);
			if (this.last?.url !== url) return;
			this.last = null;
			this.problem = null;
		}, SHOWN_MS);
	}

	async take() {
		if (this.busy) return;
		this.busy = true;
		this.problem = null;
		let url: string | null = null;
		try {
			const t = Date.now();
			const [jpeg, at] = await Promise.all([frame(), position()]);
			// Seen at once, while it goes up.
			url = URL.createObjectURL(jpeg);
			this.last = { url, state: 'sending' };
			this.#queue.push({ jpeg, t, at });
			this.waiting = this.#queue.length;
			this.busy = false;
			await this.send();
			if (this.last?.url === url) this.last.state = this.waiting ? 'waiting' : 'saved';
		} catch (err) {
			this.problem =
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'Sin permiso para la cámara: dáselo a la página en el navegador.'
					: 'No se pudo hacer la foto.';
		} finally {
			this.busy = false;
			this.#hideSoon(url);
		}
	}

	/** What waits, to the server, the oldest first; whatever does not get there, again later. */
	async send() {
		while (this.#queue.length) {
			const { jpeg, t, at } = this.#queue[0]!;
			const params = new URLSearchParams({ t: String(t) });
			if (at) {
				params.set('lon', String(at[0]));
				params.set('lat', String(at[1]));
			}
			const res = await fetch(`/carretera/foto?${params}`, {
				method: 'POST',
				headers: { 'content-type': 'image/jpeg' },
				body: jpeg
			}).catch(() => null);
			if (!res?.ok) break;
			this.#queue.shift();
			this.waiting = this.#queue.length;
		}
		clearInterval(this.#retry);
		if (this.#queue.length) this.#retry = setInterval(() => void this.send(), RETRY_EVERY_MS);
	}
}

export const roadPhotos = new RoadPhotos();
