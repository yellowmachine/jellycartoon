<script lang="ts">
	import { music } from '#lib/music-player.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';
	import {
		HISTORY_TURNS,
		type VoiceAction,
		type VoiceOption,
		type VoiceReply,
		type VoiceTurn
	} from '#lib/voice.ts';

	/**
	 * Voice commands (#33): held down, it listens, as WhatsApp's voice notes; let go, it is sent.
	 * What was understood goes to the AI, which does it; its answer is shown big and read aloud.
	 */

	/** Shorter than this, the button was tapped, not held: nothing was said. */
	const MIN_MS = 400;

	let phase = $state<'idle' | 'listening' | 'thinking'>('idle');
	let heard = $state<string | null>(null);
	let reply = $state<string | null>(null);
	let options = $state<VoiceOption[]>([]);
	let problem = $state<string | null>(null);
	/** Written instead of said: to try a sentence, or where there is no microphone. */
	let typed = $state('');
	/** The exchanges before, so that «no, eso no» means something. */
	let history: VoiceTurn[] = [];

	let recorder: MediaRecorder | null = null;
	let chunks: Blob[] = [];
	let started = 0;
	/** Let go before the microphone was ready: it stops as soon as it is. */
	let released = false;

	async function start() {
		if (phase !== 'idle') return;
		released = false;
		problem = null;
		let stream: MediaStream;
		try {
			// https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			problem = 'No se puede usar el micrófono. Hay que darle permiso a la página.';
			return;
		}
		// The browser's own format: WebM/Opus on Android, MP4/AAC on iPhone. Whisper takes both.
		recorder = new MediaRecorder(stream);
		chunks = [];
		recorder.ondataavailable = (e) => chunks.push(e.data);
		recorder.onstop = () => {
			// The microphone off, and its icon gone from the phone's bar.
			for (const track of stream.getTracks()) track.stop();
			void send(new Blob(chunks, { type: recorder?.mimeType }), performance.now() - started);
		};
		started = performance.now();
		recorder.start();
		phase = 'listening';
		if (released) stop();
	}

	function stop() {
		released = true;
		if (recorder?.state === 'recording') recorder.stop();
	}

	async function send(audio: Blob, ms: number) {
		recorder = null;
		if (ms < MIN_MS) {
			phase = 'idle';
			problem = 'Mantén pulsado el botón mientras hablas.';
			return;
		}
		phase = 'thinking';
		reply = null;
		options = [];
		const res = await fetch('/api/voice/transcribe', { method: 'POST', body: audio }).catch(
			() => null
		);
		const body = await res?.json().catch(() => null);
		if (!res?.ok) {
			phase = 'idle';
			problem = body?.message ?? 'Sin conexión';
			return;
		}
		if (!body.text) {
			phase = 'idle';
			heard = null;
			problem = 'No he oído nada. Prueba otra vez, más cerca.';
			return;
		}
		await command(body.text);
	}

	/** What sounds on this device, for the AI: «quita eso» is about it. */
	function playingHere() {
		const what = music.radio
			? `la radio ${music.radio.name}`
			: music.current
				? `«${music.current.title}» de ${music.current.artist}`
				: null;
		return what && !music.playing ? `${what} (en pausa)` : what;
	}

	async function command(text: string) {
		phase = 'thinking';
		problem = null;
		reply = null;
		options = [];
		heard = text;
		const res = await fetch('/api/voice/command', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text, here: playingHere(), history })
		}).catch(() => null);
		const body: VoiceReply | { message?: string } | null = await res?.json().catch(() => null);
		phase = 'idle';
		if (!res?.ok || !body || !('reply' in body)) {
			problem = (body && 'message' in body && body.message) || 'Sin conexión';
			return;
		}
		for (const action of body.actions) await act(action);
		reply = body.reply;
		options = body.options;
		history = [
			...history,
			{ role: 'user' as const, content: text },
			{ role: 'assistant' as const, content: body.reply }
		].slice(-HISTORY_TURNS);
		speak(body.reply);
	}

	/** What the server cannot do: play in this browser. */
	async function act(action: VoiceAction) {
		switch (action.kind) {
			case 'play':
				music.setShuffle(action.shuffle);
				return music.play(action.tracks, action.start);
			case 'radio':
				return musicTarget.playRadio(action.uuid, false);
			case 'control':
				if (action.action === 'pause') return music.pause();
				if (action.action === 'resume') return music.resume();
				return music[action.action]();
		}
	}

	/** Read aloud with the device's own voice: https://developer.mozilla.org/docs/Web/API/SpeechSynthesis */
	function speak(text: string) {
		if (!('speechSynthesis' in window)) return;
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'es-ES';
		speechSynthesis.speak(utterance);
	}
</script>

<svelte:head>
	<title>Hablar · JellyCartoon</title>
</svelte:head>

<div class="flex min-h-[70vh] flex-col items-center justify-center gap-10 py-8 text-center">
	<p class="text-3xl font-semibold text-zinc-200">
		{phase === 'listening'
			? 'Te escucho…'
			: phase === 'thinking'
				? 'Un momento…'
				: 'Mantén pulsado y habla'}
	</p>

	<!-- Touch: no selecting text nor the menu of a long press, and no scrolling while it is held. -->
	<button
		class={[
			'flex h-56 w-56 touch-none items-center justify-center rounded-full shadow-2xl transition duration-150 select-none',
			phase === 'listening'
				? 'scale-110 bg-red-500 text-white'
				: 'bg-amber-500 text-zinc-950 active:scale-95',
			phase === 'thinking' && 'opacity-60'
		]}
		aria-label="Mantén pulsado para hablar"
		disabled={phase === 'thinking'}
		onpointerdown={(e) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			void start();
		}}
		onpointerup={stop}
		onpointercancel={stop}
		oncontextmenu={(e) => e.preventDefault()}
		onkeydown={(e) => {
			if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
				e.preventDefault();
				void start();
			}
		}}
		onkeyup={(e) => {
			if (e.key === ' ' || e.key === 'Enter') stop();
		}}
	>
		<svg viewBox="0 0 24 24" class="h-24 w-24" fill="currentColor" aria-hidden="true">
			<rect x="9" y="2.5" width="6" height="12" rx="3" />
			<path
				d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>
	</button>

	<div class="min-h-24 max-w-xl text-2xl" aria-live="polite">
		{#if heard}
			<p class="text-xl text-zinc-400">«{heard}»</p>
		{/if}
		{#if problem}
			<p class="mt-3 text-amber-300">{problem}</p>
		{:else if reply}
			<p class="mt-3 text-3xl font-semibold">{reply}</p>
		{/if}
		{#if options.length}
			<!-- What was not clear: a tap on one is the same as saying it. -->
			<div class="mt-6 flex flex-col gap-3">
				{#each options as option (option.command)}
					<button
						class="rounded-2xl bg-zinc-800 px-6 py-4 text-2xl font-semibold transition hover:bg-zinc-700 active:scale-95"
						disabled={phase !== 'idle'}
						onclick={() => command(option.command)}>{option.label}</button
					>
				{/each}
			</div>
		{/if}
	</div>

	<form
		class="flex w-full max-w-xl gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			if (!typed.trim() || phase !== 'idle') return;
			void command(typed.trim());
			typed = '';
		}}
	>
		<input
			bind:value={typed}
			placeholder="O escríbelo aquí"
			aria-label="Escribir la orden"
			class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-base"
		/>
		<button
			class="rounded-md bg-zinc-800 px-4 py-2 text-base hover:bg-zinc-700"
			disabled={phase !== 'idle'}>Enviar</button
		>
	</form>
</div>
