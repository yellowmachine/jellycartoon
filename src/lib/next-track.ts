/**
 * The next track, downloaded while this one plays (the phone in the pocket): with the screen off,
 * Android lets Chrome use the network while something sounds, and cuts it in the silence between
 * two songs, when the next one used to be asked for (seen with the 1.24.1 diagnostic, «Format
 * error» seconds after a song ended). Brought from memory, it starts without the network, and the
 * one after it is downloaded meanwhile. Only one ahead; if it is not there in time, the track is
 * asked for as before.
 */

/** A failed download is tried again this often, while it is still the next one. */
const RETRY_MS = 20_000;

class NextTrack {
	/** The track's own address, what is wanted. */
	#url: string | null = null;
	/** Its copy in memory, once whole. */
	#blob: string | null = null;
	#asked: AbortController | null = null;
	#retry: ReturnType<typeof setTimeout> | undefined;

	/** This one next: downloaded, unless it already is or is on its way. */
	want(url: string) {
		if (url === this.#url) return;
		this.forget();
		this.#url = url;
		void this.#download(url);
	}

	async #download(url: string) {
		const asked = new AbortController();
		this.#asked = asked;
		try {
			const res = await fetch(url, { signal: asked.signal });
			if (!res.ok) throw new Error(`${res.status}`);
			const blob = await res.blob();
			if (this.#url !== url) return;
			this.#blob = URL.createObjectURL(blob);
		} catch {
			if (asked.signal.aborted || this.#url !== url) return;
			this.#retry = setTimeout(() => {
				if (this.#url === url) void this.#download(url);
			}, RETRY_MS);
		} finally {
			if (this.#asked === asked) this.#asked = null;
		}
	}

	/**
	 * The copy to play instead of `url`, if it is that one and whole; it is the caller's from then
	 * on (`URL.revokeObjectURL` when done). Null: `url` as it is.
	 */
	take(url: string): string | null {
		if (url !== this.#url || !this.#blob) return null;
		const blob = this.#blob;
		this.#blob = null;
		this.#url = null;
		return blob;
	}

	/** Not wanted any more (another queue, the radio, the end). */
	forget() {
		clearTimeout(this.#retry);
		this.#asked?.abort();
		this.#asked = null;
		if (this.#blob) URL.revokeObjectURL(this.#blob);
		this.#blob = null;
		this.#url = null;
	}
}

export const nextTrack = new NextTrack();
