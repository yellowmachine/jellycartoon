import { worthKeeping, type TripPoint } from '#lib/trips.ts';

/**
 * The road mode's trip being kept (#81), for whoever turned it on: its own watch on the GPS (the
 * map may not be shown, in half of the screen), a position every ~25 m, sent every half minute.
 * Without signal they wait, and go with the next batch that gets through.
 */

const SEND_EVERY_MS = 30_000;
/** Waiting at most this many: hours without signal, the oldest go. */
const MAX_WAITING = 5000;

class TripRecorder {
	/** Positions not sent yet. */
	waiting = $state(0);
	/** Why it cannot, if it cannot. */
	problem = $state<string | null>(null);

	#points: TripPoint[] = [];
	#last: TripPoint | null = null;
	#watch: number | null = null;
	#timer: ReturnType<typeof setInterval> | undefined;
	#destination: () => string | null = () => null;
	#sending = false;

	/** While the road mode is open; `destination`, the route's, said with each batch. */
	start(destination: () => string | null) {
		if (this.#watch !== null) return;
		this.#destination = destination;
		if (!('geolocation' in navigator)) {
			this.problem = 'Este navegador no da la posición: no se puede guardar el viaje.';
			return;
		}
		this.#watch = navigator.geolocation.watchPosition(
			({ coords, timestamp }) => {
				const point: TripPoint = {
					t: timestamp,
					at: [coords.longitude, coords.latitude],
					speed: coords.speed
				};
				if (!worthKeeping(this.#last, point, coords.accuracy)) return;
				this.#last = point;
				this.#points.push(point);
				if (this.#points.length > MAX_WAITING) this.#points.shift();
				this.waiting = this.#points.length;
				this.problem = null;
			},
			(err) => {
				if (err.code === err.PERMISSION_DENIED)
					this.problem = 'Sin permiso para la posición: no se puede guardar el viaje.';
			},
			{ enableHighAccuracy: true, maximumAge: 2000 }
		);
		this.#timer = setInterval(() => void this.send(), SEND_EVERY_MS);
		addEventListener('pagehide', this.#leave);
	}

	stop() {
		if (this.#watch !== null) navigator.geolocation.clearWatch(this.#watch);
		this.#watch = null;
		clearInterval(this.#timer);
		removeEventListener('pagehide', this.#leave);
		this.#leave();
	}

	/** What is waiting, to the server; kept if it does not get there. */
	async send() {
		if (this.#sending || !this.#points.length) return;
		this.#sending = true;
		const batch = this.#points.slice();
		const res = await fetch('/carretera/viaje', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ points: batch, destination: this.#destination() })
		}).catch(() => null);
		this.#sending = false;
		if (!res?.ok) return;
		this.#points.splice(0, batch.length);
		this.waiting = this.#points.length;
	}

	/** Leaving (the page closed, another app): what is waiting, as it can still go. */
	#leave = () => {
		if (!this.#points.length) return;
		const body = JSON.stringify({ points: this.#points, destination: this.#destination() });
		if (navigator.sendBeacon('/carretera/viaje', new Blob([body], { type: 'application/json' }))) {
			this.#points = [];
			this.waiting = 0;
		}
	};
}

export const tripRecorder = new TripRecorder();
