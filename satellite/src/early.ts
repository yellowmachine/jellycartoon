/**
 * The order heard while the silence that ends it is still being waited for: sent after a moment of
 * quiet, and dropped if the voice comes back. With the order over, what was said is there or about
 * to be, and only the answer is left to wait for (2026-11-07). Nothing is done with the text until
 * then, so a pause in the middle only costs a transcription.
 */
export class EarlyHearing {
	#controller: AbortController | null = null;
	#heard: Promise<string | null> | null = null;

	/** `afterMs`: this long quiet, it is sent; 0, never. `send` gives null if it has no text. */
	constructor(
		private afterMs: number,
		private send: (wav: Uint8Array, signal: AbortSignal) => Promise<string | null>
	) {}

	/** At each frame, with how long it has been quiet. True if it dropped one, the voice having come back. */
	update(quietMs: number, audio: () => Uint8Array) {
		if (quietMs === 0) return this.cancel();
		if (this.afterMs && quietMs >= this.afterMs && !this.#heard) {
			this.#controller = new AbortController();
			this.#heard = this.send(audio(), this.#controller.signal).catch(() => null);
		}
		return false;
	}

	/** What was heard of it, if it was sent; it never fails, null if it has to be sent whole. */
	get heard() {
		return this.#heard;
	}

	cancel() {
		if (!this.#heard) return false;
		this.#controller?.abort();
		this.#controller = null;
		this.#heard = null;
		return true;
	}
}
