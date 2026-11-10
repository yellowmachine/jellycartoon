import type { CallEvent, CallOutcome, IceCandidate } from '#lib/calls.ts';

/**
 * This device's call (#330), one at a time: the microphone, the WebRTC connection to the other side
 * (https://developer.mozilla.org/docs/Web/API/RTCPeerConnection) and the call's events from Seilide.
 * Whoever called makes the offer once the other answers; whoever answers, the answer. Candidates go
 * as they come (trickle ICE), and those that arrive before the other's description wait for it.
 */

export type PhoneState = 'idle' | 'calling' | 'incoming' | 'connecting' | 'connected' | 'ended';

/** Echo cancelled by the browser itself: the car's speakers are next to the microphone. */
const MIC: MediaStreamConstraints = {
	audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
	video: false
};

async function post(url: string, body: unknown) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	}).catch(() => null);
	if (!res) return { ok: false as const, problem: 'Sin conexión con Seilide.' };
	const data = (await res.json().catch(() => ({}))) as { id?: string; problem?: string };
	return res.ok
		? { ok: true as const, id: data.id }
		: { ok: false as const, problem: data.problem ?? 'No se pudo.' };
}

/**
 * Tones, made here (no file to load): the ringback heard while the other's phone rings, as
 * Spain's (425 Hz, 1.5 s on and 3 s off), and a two-note ring for a call coming in.
 */
class Tones {
	#context: AudioContext | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;

	#beep(frequencies: number[], seconds: number) {
		const context = (this.#context ??= new AudioContext());
		void context.resume();
		const gain = context.createGain();
		gain.gain.value = 0.15;
		gain.connect(context.destination);
		frequencies.forEach((f, i) => {
			const osc = context.createOscillator();
			osc.frequency.value = f;
			osc.connect(gain);
			const at = context.currentTime + (i * seconds) / frequencies.length;
			osc.start(at);
			osc.stop(at + seconds / frequencies.length);
		});
	}

	ringback() {
		this.stop();
		this.#beep([425], 1.5);
		this.#timer = setInterval(() => this.#beep([425], 1.5), 4500);
	}

	ring() {
		this.stop();
		const ring = () => this.#beep([880, 660, 880, 660], 1.2);
		ring();
		this.#timer = setInterval(ring, 3000);
	}

	stop() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}

class Phone {
	state = $state<PhoneState>('idle');
	id = $state<string | null>(null);
	role = $state<'caller' | 'callee' | null>(null);
	otherName = $state('');
	/** When the sound started both ways: the talk's clock. */
	connectedAt = $state<number | null>(null);
	outcome = $state<CallOutcome | null>(null);
	problem = $state<string | null>(null);
	/** The other's sound, for an <audio> in the page. */
	remote = $state<MediaStream | null>(null);
	muted = $state(false);

	/** Ringing, talking or about to: the music and the wake word keep quiet meanwhile. */
	busy = $derived(this.state !== 'idle' && this.state !== 'ended');

	#pc: RTCPeerConnection | null = null;
	#local: MediaStream | null = null;
	#events: EventSource | null = null;
	#pending: IceCandidate[] = [];
	/** Answered, as Seilide says: hanging up is then «Contestada», even before the sound came. */
	#accepted = false;
	/** The call's events, one after another: each waits for the one before (descriptions, then candidates). */
	#line: Promise<void> = Promise.resolve();
	/** The offer made, or the answer: once, even if Seilide says it twice (a reconnection). */
	#negotiated = false;
	/** What this side sends, one after another (`#signal`). */
	#out: Promise<void> = Promise.resolve();
	#described = false;
	#early: { type: 'ice'; candidate: unknown }[] = [];
	#tones = new Tones();
	/** This page, for Seilide: of the person's devices, which one is in the call. */
	#device = typeof crypto !== 'undefined' ? crypto.randomUUID() : '';

	/** A call to someone of the family. */
	async call(to: string, name: string) {
		if (this.busy) return;
		this.#begin(null, 'caller', name, 'calling');
		if (!(await this.#microphone())) return;
		const made = await post('/api/llamadas', { to, aparato: this.#device });
		if (!made.ok || !made.id) return this.#finish(null, made.ok ? 'No se pudo.' : made.problem);
		this.id = made.id;
		this.#tones.ringback();
		this.#listen(made.id);
	}

	/** A call of theirs, from its page or a notice: ringing for them, or already over. */
	open(
		id: string,
		info: {
			role: 'caller' | 'callee';
			otherName: string;
			state: string;
			outcome: CallOutcome | null;
		}
	) {
		if (this.id === id && this.state !== 'ended') return;
		this.#cleanup();
		if (info.state === 'ended') {
			this.#begin(id, info.role, info.otherName, 'ended');
			this.outcome = info.outcome;
			return;
		}
		if (info.state === 'connected') {
			// This page was not in it (reloaded, or another device of theirs): it can only hang up.
			this.#begin(id, info.role, info.otherName, 'ended');
			this.problem = 'La llamada sigue en otro aparato o se cortó al recargar.';
			return;
		}
		if (info.role === 'caller') return; // Ringing, from where it was made.
		this.#begin(id, 'callee', info.otherName, 'incoming');
		this.#listen(id);
	}

	/** Ringing for this person (Carretera's notice on screen): as if its page were open. */
	incoming(id: string, fromName: string) {
		if (this.busy) return;
		this.open(id, { role: 'callee', otherName: fromName, state: 'ringing', outcome: null });
		this.#tones.ring();
	}

	async answer() {
		if (this.state !== 'incoming' || !this.id) return;
		this.#tones.stop();
		this.state = 'connecting';
		if (!(await this.#microphone())) return void this.#send({ type: 'reject' });
		const done = await this.#send({ type: 'accept' });
		if (!done.ok) this.#finish(null, done.problem);
	}

	reject() {
		if (this.state !== 'incoming') return;
		void this.#send({ type: 'reject' });
		this.#finish('rejected');
	}

	hangup() {
		if (!this.busy) return;
		if (this.id) void this.#send({ type: 'hangup' });
		this.#finish(this.#accepted ? 'answered' : this.role === 'caller' ? 'cancelled' : 'rejected');
	}

	toggleMute() {
		this.muted = !this.muted;
		for (const track of this.#local?.getAudioTracks() ?? []) track.enabled = !this.muted;
	}

	/** «Cerrar», after it ended. */
	reset() {
		if (this.busy) return;
		this.#cleanup();
		this.state = 'idle';
		this.id = null;
		this.role = null;
		this.otherName = '';
		this.outcome = null;
		this.problem = null;
	}

	/** A ringing call, gone from the list of ringing ones: answered elsewhere, or over. */
	stopRingingIfGone(ringing: string[]) {
		if (this.state === 'incoming' && this.id && !ringing.includes(this.id)) this.#tones.stop();
	}

	#begin(id: string | null, role: 'caller' | 'callee', name: string, state: PhoneState) {
		this.id = id;
		this.role = role;
		this.otherName = name;
		this.state = state;
		this.connectedAt = null;
		this.outcome = null;
		this.problem = null;
		this.muted = false;
		this.#accepted = false;
		this.#negotiated = false;
		this.#described = false;
		this.#early = [];
	}

	async #microphone() {
		try {
			this.#local = await navigator.mediaDevices.getUserMedia(MIC);
			return true;
		} catch (err) {
			this.#finish(
				null,
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'No se puede usar el micrófono. Hay que darle permiso a la página.'
					: 'No se pudo abrir el micrófono.'
			);
			return false;
		}
	}

	#send(message: object) {
		return post(`/api/llamadas/${this.id}`, { ...message, aparato: this.#device });
	}

	/**
	 * Signals, in order, one after another: the offer or the answer first, then the candidates.
	 * Those found before it went wait, or the other would reach this device before it knows how to
	 * talk to it, and the encryption (DTLS) would take long retries to start.
	 */
	#signal(
		message: { type: 'offer' | 'answer'; sdp?: string } | { type: 'ice'; candidate: unknown }
	) {
		if (message.type === 'ice' && !this.#described) return void this.#early.push(message);
		const send = () => this.#send(message).then(() => undefined);
		this.#out = this.#out.then(send, send);
		if (message.type !== 'ice') {
			this.#described = true;
			for (const early of this.#early.splice(0)) this.#signal(early);
		}
	}

	#listen(id: string) {
		const events = new EventSource(`/api/llamadas/${id}/eventos?aparato=${this.#device}`);
		this.#events = events;
		events.onmessage = (e) => {
			const event = JSON.parse(e.data) as CallEvent;
			this.#line = this.#line
				.then(() => (this.#events === events ? this.#event(event) : undefined))
				.catch((err: unknown) => console.warn('[llamada]', err));
		};
		// Over before it was opened (404), or the server gone for good.
		events.onerror = () => {
			if (events.readyState === EventSource.CLOSED && this.busy) this.#finish(null);
		};
	}

	async #event(event: CallEvent) {
		switch (event.type) {
			case 'state':
				if (event.state === 'ended') return this.#finish(event.outcome);
				if (event.state === 'connected' && this.state === 'incoming')
					// Ringing here, answered on another of their devices.
					return this.#finish('answered', 'Contestada en otro aparato.');
				if (event.state === 'connected') this.#accepted = true;
				if (event.state === 'connected' && this.role === 'caller' && !this.#negotiated) {
					this.#negotiated = true;
					this.#tones.stop();
					this.state = 'connecting';
					const pc = await this.#peer();
					const offer = await pc.createOffer();
					await pc.setLocalDescription(offer);
					this.#signal({ type: 'offer', sdp: offer.sdp });
				}
				return;
			case 'offer': {
				if (this.role !== 'callee' || this.#negotiated) return;
				this.#negotiated = true;
				const pc = this.#pc ?? (await this.#peer());
				await pc.setRemoteDescription({ type: 'offer', sdp: event.sdp });
				await this.#flush();
				const answer = await pc.createAnswer();
				await pc.setLocalDescription(answer);
				this.#signal({ type: 'answer', sdp: answer.sdp });
				return;
			}
			case 'answer':
				if (this.#pc?.signalingState !== 'have-local-offer') return;
				await this.#pc.setRemoteDescription({ type: 'answer', sdp: event.sdp });
				await this.#flush();
				return;
			case 'ice':
				if (this.#pc?.remoteDescription) await this.#addIce(event.candidate);
				else this.#pending.push(event.candidate);
				return;
		}
	}

	async #addIce(candidate: IceCandidate) {
		await this.#pc
			?.addIceCandidate(candidate.candidate ? candidate : null)
			.catch((err: unknown) => console.warn('[llamada] Candidato no válido', err));
	}

	async #flush() {
		for (const candidate of this.#pending.splice(0)) await this.#addIce(candidate);
	}

	async #peer() {
		const res = await fetch('/api/llamadas/ice').catch(() => null);
		const iceServers: RTCIceServer[] = res?.ok ? await res.json() : [];
		const pc = new RTCPeerConnection({ iceServers });
		this.#pc = pc;
		for (const track of this.#local?.getTracks() ?? []) pc.addTrack(track, this.#local!);
		pc.onicecandidate = (e) => {
			if (e.candidate) this.#signal({ type: 'ice', candidate: e.candidate.toJSON() });
		};
		pc.ontrack = (e) => (this.remote = e.streams[0] ?? new MediaStream([e.track]));
		pc.onconnectionstatechange = () => {
			if (this.#pc !== pc) return;
			if (pc.connectionState === 'connected' && this.connectedAt === null) {
				this.connectedAt = Date.now();
				this.state = 'connected';
			} else if (pc.connectionState === 'failed') {
				void this.#send({ type: 'hangup' });
				this.#finish(
					this.connectedAt ? 'answered' : null,
					'No se pudo conectar con el otro aparato.'
				);
			}
		};
		return pc;
	}

	#finish(outcome: CallOutcome | null, problem?: string) {
		this.#cleanup();
		this.state = 'ended';
		this.outcome = outcome;
		if (problem) this.problem = problem;
	}

	#cleanup() {
		this.#tones.stop();
		this.#events?.close();
		this.#events = null;
		this.#pc?.close();
		this.#pc = null;
		for (const track of this.#local?.getTracks() ?? []) track.stop();
		this.#local = null;
		this.#pending = [];
		this.remote = null;
	}
}

export const phone = new Phone();
