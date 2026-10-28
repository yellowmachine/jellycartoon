/**
 * The trips being shared (#81), in memory only: for each link's token, who, where to, and the last
 * position. Nothing is written anywhere. A trip with no news for IDLE_MS ends by itself; an ended
 * one is remembered a while, to tell whoever opens its link that it is over, and then forgotten.
 */

export const IDLE_MS = 2 * 60 * 60_000;
export const FORGET_MS = 6 * 60 * 60_000;

/** A link's token: 16 random bytes, base64url. */
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export interface Position {
	lon: number;
	lat: number;
	/** When, ms since 1970. */
	t: number;
	/** m/s and degrees, if the GPS says. */
	speed: number | null;
	heading: number | null;
}

export interface Shared {
	name: string;
	destination: string | null;
	/** When it is expected there (ms since 1970), with a route. */
	arrivesAt: number | null;
	position: Position | null;
	updatedAt: number;
	ended: boolean;
}

export type Update = Partial<Pick<Shared, 'name' | 'destination' | 'arrivesAt' | 'position'>>;

export class TripStore {
	#trips = new Map<string, Shared>();
	#watchers = new Map<string, Set<(trip: Shared) => void>>();

	constructor(private readonly now: () => number = Date.now) {}

	get(token: string) {
		return this.#trips.get(token) ?? null;
	}

	/** News from home: a new trip, or the same one moving on. An ended one does not come back. */
	publish(token: string, update: Update) {
		const before = this.#trips.get(token);
		if (before?.ended) return before;
		const trip: Shared = {
			name: update.name ?? before?.name ?? '',
			destination:
				update.destination !== undefined ? update.destination : (before?.destination ?? null),
			arrivesAt: update.arrivesAt !== undefined ? update.arrivesAt : (before?.arrivesAt ?? null),
			position: update.position ?? before?.position ?? null,
			updatedAt: this.now(),
			ended: false
		};
		this.#trips.set(token, trip);
		this.#tell(token, trip);
		return trip;
	}

	/** Stopped from home, or arrived: its link no longer shows where. */
	end(token: string) {
		const before = this.#trips.get(token);
		const trip: Shared = {
			...(before ?? { name: '', destination: null, arrivesAt: null }),
			position: null,
			updatedAt: this.now(),
			ended: true
		};
		this.#trips.set(token, trip);
		this.#tell(token, trip);
	}

	/** Calls `watcher` on every change of that trip; returns what stops it. */
	watch(token: string, watcher: (trip: Shared) => void) {
		let set = this.#watchers.get(token);
		if (!set) this.#watchers.set(token, (set = new Set()));
		set.add(watcher);
		return () => {
			set.delete(watcher);
			if (!set.size) this.#watchers.delete(token);
		};
	}

	/** Every minute or so: quiet ones end, ended ones are forgotten after a while. */
	sweep() {
		const now = this.now();
		for (const [token, trip] of this.#trips) {
			if (trip.ended && now - trip.updatedAt > FORGET_MS) this.#trips.delete(token);
			else if (!trip.ended && now - trip.updatedAt > IDLE_MS) this.end(token);
		}
	}

	#tell(token: string, trip: Shared) {
		for (const watcher of this.#watchers.get(token) ?? []) watcher(trip);
	}
}
