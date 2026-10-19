/**
 * Sharing the trip (#81) from the road mode: the link made by the server, and while it is shared,
 * where we are every few seconds, with the route's destination and arrival. Never on by itself;
 * it stops when told, when arrived, and when the road mode closes.
 */

/** Every this often, the latest position: the server sends it on at most every 10 s too. */
const TELL_EVERY_MS = 10_000;

interface News {
	destination: string | null;
	/** ms since 1970. */
	arrivesAt: number | null;
}

class TripShare {
	/** The link, while shared. */
	url = $state<string | null>(null);
	busy = $state(false);
	problem = $state<string | null>(null);

	#watch: number | null = null;
	#timer: ReturnType<typeof setInterval> | undefined;
	#latest: {
		lon: number;
		lat: number;
		t: number;
		speed: number | null;
		heading: number | null;
	} | null = null;
	#news: () => News = () => ({ destination: null, arrivesAt: null });

	async #post(body: object) {
		const res = await fetch('/carretera/compartir', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		const answer = await res?.json().catch(() => null);
		return res?.ok ? answer : Promise.reject(new Error(answer?.message ?? 'Sin conexión'));
	}

	/** `news`: the route's, read at each update. */
	async start(news: () => News) {
		if (this.url || this.busy) return;
		this.busy = true;
		this.problem = null;
		this.#news = news;
		try {
			this.url = (await this.#post({ action: 'start' })).url;
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
			return;
		} finally {
			this.busy = false;
		}
		this.#watch = navigator.geolocation.watchPosition(
			({ coords, timestamp }) => {
				this.#latest = {
					lon: coords.longitude,
					lat: coords.latitude,
					t: timestamp,
					speed: coords.speed,
					heading: coords.heading
				};
			},
			() => {},
			{ enableHighAccuracy: true, maximumAge: 2000 }
		);
		this.#timer = setInterval(() => void this.#tell(), TELL_EVERY_MS);
		addEventListener('pagehide', this.#leave);
	}

	async #tell() {
		if (!this.url) return;
		const answer = await this.#post({
			action: 'update',
			position: this.#latest,
			...this.#news()
		}).catch(() => null);
		// Stopped at the server (silent too long): said here too.
		if (answer && !answer.sharing) this.#stopped();
	}

	async stop() {
		if (!this.url) return;
		this.#stopped();
		await this.#post({ action: 'stop' }).catch(() => {});
	}

	#stopped() {
		this.url = null;
		if (this.#watch !== null) navigator.geolocation.clearWatch(this.#watch);
		this.#watch = null;
		clearInterval(this.#timer);
		removeEventListener('pagehide', this.#leave);
	}

	/** Closing the road mode: it stops, as it can still go. */
	#leave = () => {
		if (!this.url) return;
		this.#stopped();
		navigator.sendBeacon(
			'/carretera/compartir',
			new Blob([JSON.stringify({ action: 'stop' })], { type: 'application/json' })
		);
	};
}

export const tripShare = new TripShare();
