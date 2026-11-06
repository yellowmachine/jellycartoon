import { invalidateAll } from '$app/navigation';
import {
	attachmentsOf,
	discardAttachment,
	retryAttachment,
	sendAttachments
} from '#lib/walk-attachments.ts';

export interface RejectedAttachment {
	id: string;
	kind: 'foto' | 'nota';
	at: number;
	why: string;
}

/**
 * The queue of photos and notes on this device (#416), as the pages show it: one sending at a time,
 * however many ask, and how it is going.
 */
class WalkUploads {
	sending = $state(false);
	done = $state(0);
	total = $state(0);
	/** Waiting to be sent, not counting a walk still not at the server. */
	waiting = $state(0);
	rejected = $state<RejectedAttachment[]>([]);
	problem = $state<string | null>(null);
	/** Goes up with each one that arrives: what shows them looks again. */
	arrived = $state(0);

	#userId: string | null = null;
	/** When the walk not at the server yet started: what is of it waits. */
	#holding: () => number | null = () => null;
	#again = false;

	holdBack(holding: () => number | null) {
		this.#holding = holding;
	}

	/** How the queue is, without sending anything. */
	async look(userId: string) {
		this.#userId = userId;
		const holding = this.#holding();
		const all = await attachmentsOf(userId).catch(() => []);
		this.waiting = all.filter(
			(a) => !a.rejected && !(a.walk !== null && a.walk === holding)
		).length;
		this.rejected = all
			.filter((a) => a.rejected)
			.sort((x, y) => x.at - y.at)
			.map((a) => ({ id: a.id, kind: a.kind, at: a.at, why: a.rejected! }));
	}

	async send(userId: string) {
		this.#userId = userId;
		if (this.sending) return void (this.#again = true);
		this.sending = true;
		let sent = 0;
		do {
			this.#again = false;
			await this.look(this.#userId);
			if (!this.waiting) break;
			let before = 0;
			const result = await sendAttachments(this.#userId, this.#holding(), (done, total) => {
				this.done = done;
				this.total = total;
				if (done > before) this.arrived++;
				before = done;
			}).catch(() => ({ sent: 0, problem: 'No se ha podido leer lo guardado en este móvil' }));
			sent += result.sent;
			this.problem = result.problem;
		} while (this.#again && !this.problem);
		await this.look(this.#userId);
		if (!this.waiting) this.problem = null;
		this.sending = false;
		this.done = this.total = 0;
		// Only then: without coverage, asking for the page again would leave the browser's error.
		if (sent) await invalidateAll().catch(() => {});
	}

	/** Once more: the connection is back, or the page, or someone asks. */
	retry() {
		if (this.#userId) void this.send(this.#userId);
	}

	async retryRejected(id: string) {
		await retryAttachment(id);
		this.retry();
	}

	async discard(id: string) {
		await discardAttachment(id);
		if (this.#userId) await this.look(this.#userId);
	}
}

export const walkUploads = new WalkUploads();
