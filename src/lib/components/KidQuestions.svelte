<script lang="ts">
	import type { VoiceTurn } from 'comun/voice.ts';

	/**
	 * Questions about what the children watch, written or said, answered by the AI from the
	 * database. Said, the answer is also read aloud; held down, the microphone listens, as in /voz.
	 */

	let { voice }: { voice: boolean } = $props();

	/** Shorter than this, the button was tapped, not held: nothing was said. */
	const MIN_MS = 400;

	let phase = $state<'idle' | 'listening' | 'thinking'>('idle');
	let turns = $state<VoiceTurn[]>([]);
	let problem = $state<string | null>(null);
	let typed = $state('');

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
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			problem = 'No se puede usar el micrófono. Hay que darle permiso a la página.';
			return;
		}
		recorder = new MediaRecorder(stream);
		chunks = [];
		recorder.ondataavailable = (e) => chunks.push(e.data);
		recorder.onstop = () => {
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
		if (!res?.ok || !body?.text) {
			phase = 'idle';
			problem = res?.ok
				? 'No he oído nada. Prueba otra vez, más cerca.'
				: (body?.message ?? 'Sin conexión');
			return;
		}
		await ask(body.text, true);
	}

	async function ask(text: string, aloud: boolean) {
		phase = 'thinking';
		problem = null;
		const history = turns;
		turns = [...turns, { role: 'user', content: text }];
		const res = await fetch('/infantil/pregunta', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text, history })
		}).catch(() => null);
		const body: { reply?: string; message?: string } | null = await res?.json().catch(() => null);
		phase = 'idle';
		if (!res?.ok || !body?.reply) {
			turns = history;
			problem = body?.message ?? 'Sin conexión';
			return;
		}
		turns = [...turns, { role: 'assistant', content: body.reply }];
		if (aloud) speak(body.reply);
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

<section class="mb-10 rounded-md border border-zinc-800 p-4">
	<h2 class="mb-1 text-xl font-semibold">Pregunta</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Sobre lo que han visto: «¿Cuánto vio la semana pasada?», «¿Qué serie le gusta más este mes?»,
		«¿Ha visto más que la semana anterior?». La IA solo consulta, no cambia nada.
	</p>

	{#if turns.length}
		<ol class="mb-4 space-y-3" aria-live="polite">
			{#each turns as turn, i (i)}
				<li class={turn.role === 'user' ? 'text-zinc-400' : 'text-lg'}>
					{turn.role === 'user' ? `«${turn.content}»` : turn.content}
				</li>
			{/each}
		</ol>
	{/if}
	{#if phase === 'thinking'}
		<p class="mb-4 text-zinc-400">Un momento…</p>
	{:else if phase === 'listening'}
		<p class="mb-4 text-zinc-400">Te escucho…</p>
	{/if}
	{#if problem}
		<p class="mb-4 text-amber-300">{problem}</p>
	{/if}

	<form
		class="flex max-w-xl gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			if (!typed.trim() || phase !== 'idle') return;
			void ask(typed.trim(), false);
			typed = '';
		}}
	>
		<input
			bind:value={typed}
			placeholder="Escribe la pregunta"
			aria-label="Pregunta sobre lo que han visto"
			class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2"
		/>
		<button class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700" disabled={phase !== 'idle'}
			>Preguntar</button
		>
		{#if voice}
			<!-- Touch: no selecting text nor the menu of a long press, and no scrolling while it is held. -->
			<button
				type="button"
				class={[
					'flex touch-none items-center rounded-md px-3 select-none',
					phase === 'listening' ? 'bg-red-500 text-white' : 'bg-amber-500 text-zinc-950'
				]}
				aria-label="Mantén pulsado para preguntar hablando"
				title="Mantén pulsado y habla"
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
				<svg viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor" aria-hidden="true">
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
		{/if}
		{#if turns.length}
			<button
				type="button"
				class="rounded-md px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-900"
				disabled={phase !== 'idle'}
				onclick={() => (turns = [])}>Empezar de nuevo</button
			>
		{/if}
	</form>
</section>
