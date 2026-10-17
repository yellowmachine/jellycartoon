<script lang="ts">
	/**
	 * Voice commands (#33): held down, it listens, as WhatsApp's voice notes; let go, it is sent.
	 * For now it only says what it understood: the AI that acts on it comes next.
	 */

	/** Shorter than this, the button was tapped, not held: nothing was said. */
	const MIN_MS = 400;

	let phase = $state<'idle' | 'listening' | 'thinking'>('idle');
	let heard = $state<string | null>(null);
	let problem = $state<string | null>(null);

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
		const res = await fetch('/api/voice/transcribe', { method: 'POST', body: audio }).catch(
			() => null
		);
		const body = await res?.json().catch(() => null);
		phase = 'idle';
		if (!res?.ok) {
			problem = body?.message ?? 'Sin conexión';
			return;
		}
		heard = body.text || null;
		if (!heard) problem = 'No he oído nada. Prueba otra vez, más cerca.';
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
		{#if problem}
			<p class="text-amber-300">{problem}</p>
		{:else if heard}
			<p class="text-zinc-400">Has dicho:</p>
			<p class="mt-1 text-3xl font-semibold">«{heard}»</p>
		{/if}
	</div>
</div>
