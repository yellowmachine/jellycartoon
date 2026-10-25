<script lang="ts">
	import { onDestroy } from 'svelte';
	import { listen, type Listening } from '#lib/wakeword-listener.ts';

	/**
	 * Trying wake words on this phone or tablet (#144, phase 1): «hola casita» and «hey luna», the
	 * community's openWakeWord models, and «candy candy» and «Jelly Cartoon», trained for this house; heard in the
	 * browser. Live scores, and each detection marked as right or not, to know how well each works
	 * here and how often it goes off by itself.
	 */
	const WORDS = [
		{ model: 'hola_casita', label: 'Hola casita' },
		{ model: 'hey_luna', label: 'Hey luna' },
		{ model: 'candy_candy', label: 'Candy candy' },
		{ model: 'jelly_cartoon', label: 'Jelly Cartoon' }
	];
	/** After a detection, the same word is not counted again for this long. */
	const QUIET_MS = 2000;

	type Detection = { id: number; word: string; at: Date; score: number; right: boolean | null };

	let status = $state<'off' | 'loading' | 'on'>('off');
	let problem = $state<string | null>(null);
	let processing = $state(true);
	let threshold = $state(0.5);
	let scores = $state(WORDS.map(() => 0));
	let peaks = $state(WORDS.map(() => 0));
	let ms = $state(0);
	let detections = $state<Detection[]>([]);
	let since = $state<number | null>(null);
	let now = $state(Date.now());

	let level = $state(-90);
	let info = $state<Listening['info'] | null>(null);
	let listening: Listening | null = null;
	let context: AudioContext | null = null;
	let lock: WakeLockSentinel | null = null;
	let lastAt = WORDS.map(() => 0);
	let nextId = 1;
	let clock: ReturnType<typeof setInterval> | undefined;

	async function start() {
		status = 'loading';
		problem = null;
		// Now, on the tap: made after loading the models, Android leaves it suspended.
		context = new AudioContext();
		try {
			listening = await listen(
				{
					models: WORDS.map((w) => w.model),
					processing,
					onScores(s, took) {
						scores = s;
						peaks = peaks.map((p, i) => Math.max(p * 0.97, s[i]!));
						ms = ms ? ms * 0.95 + took * 0.05 : took;
						const t = Date.now();
						s.forEach((score, i) => {
							if (score < threshold || t - lastAt[i]! < QUIET_MS) return;
							lastAt[i] = t;
							detections = [
								{ id: nextId++, word: WORDS[i]!.label, at: new Date(t), score, right: null },
								...detections
							];
							navigator.vibrate?.(200);
						});
					},
					onLevel(db) {
						level = Math.max(db, level - 1.5);
					}
				},
				context
			);
			info = listening.info;
			status = 'on';
			since = Date.now();
			clock = setInterval(() => (now = Date.now()), 1000);
			// The screen on while it listens: off, the browser stops the microphone.
			lock = await navigator.wakeLock?.request('screen').catch(() => null);
		} catch (err) {
			stop();
			problem = err instanceof Error ? err.message : String(err);
		}
	}

	function stop() {
		listening?.stop();
		listening = null;
		if (context && context.state !== 'closed') void context.close();
		context = null;
		void lock?.release().catch(() => {});
		lock = null;
		clearInterval(clock);
		status = 'off';
	}

	onDestroy(stop);

	const hours = $derived(since ? (now - since) / 3_600_000 : 0);
	const elapsed = $derived(
		since
			? `${Math.floor((now - since) / 60_000)} min ${Math.floor(((now - since) / 1000) % 60)} s`
			: ''
	);
	/** For each word: right, wrong (gone off by itself) and wrong per hour listening. */
	const stats = $derived(
		WORDS.map((w) => {
			const mine = detections.filter((d) => d.word === w.label);
			const wrong = mine.filter((d) => d.right === false).length;
			return {
				right: mine.filter((d) => d.right === true).length,
				wrong,
				perHour: hours > 0 ? wrong / hours : 0
			};
		})
	);
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'medium' });
</script>

<svelte:head>
	<title>Palabra de activación · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-xl">
	<h1 class="mb-1 text-2xl font-bold">Palabra de activación</h1>
	<p class="mb-4 text-sm text-zinc-400">
		Prueba de «hola casita», «hey luna», «candy candy» y «Jelly Cartoon» en este dispositivo, sin
		pulsar nada: escucha mientras esta página está abierta y delante. Di una de ellas y mira si
		salta; marca cada detección como buena o sin querer, para saber cuál funciona mejor y cuántas
		veces salta sola (con la tele puesta, mejor). Nada sale del dispositivo.
	</p>
	<p class="mb-4 text-sm">
		<a href="/activacion/grabar" class="text-amber-400 hover:underline">Grabar la palabra</a>
		<span class="text-zinc-400">: vuestras voces, para entrenar su modelo.</span>
	</p>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		{#if status === 'on'}
			<button
				class="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500"
				onclick={stop}>Parar</button
			>
			<span class="text-sm text-zinc-400"
				>Escuchando · {elapsed} · {ms.toFixed(0)} ms cada 80 ms</span
			>
		{:else}
			<button
				class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
				disabled={status === 'loading'}
				onclick={start}
				>{status === 'loading' ? 'Cargando (unos 6 MB la primera vez)…' : 'Escuchar'}</button
			>
			<label class="flex items-center gap-2 text-sm text-zinc-300">
				<input
					type="checkbox"
					bind:checked={processing}
					class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
				/>
				Limpiar el sonido (eco, ruido, volumen)
			</label>
		{/if}
	</div>
	{#if problem}
		<p class="mb-4 text-sm text-red-400">{problem}</p>
	{/if}
	{#if status === 'on' && info}
		<!-- What arrives: if the bars do not move, this says why. -->
		<div class="mb-4 rounded-md border border-zinc-800 p-3 text-xs text-zinc-400">
			<div class="mb-1 flex items-center gap-2">
				<span class="w-24 shrink-0">Nivel {level.toFixed(0)} dB</span>
				<div class="h-2 flex-1 overflow-hidden rounded bg-zinc-800">
					<div
						class="h-full bg-sky-500"
						style:width="{Math.max(0, (level + 90) / 90) * 100}%"
					></div>
				</div>
			</div>
			<p>
				Audio {info.state === 'running' ? 'en marcha' : `parado (${info.state})`} · {info.contextRate}
				Hz (micrófono {info.micRate ?? '?'} Hz) · eco {info.echoCancellation ? 'sí' : 'no'} · ruido
				{info.noiseSuppression ? 'sí' : 'no'} · volumen {info.autoGainControl ? 'sí' : 'no'}
			</p>
		</div>
	{/if}

	<label class="mb-4 flex items-center gap-3 text-sm">
		Umbral
		<input
			type="range"
			min="0.1"
			max="0.95"
			step="0.05"
			bind:value={threshold}
			class="flex-1 accent-amber-500"
		/>
		<span class="w-10 text-right tabular-nums">{threshold.toFixed(2)}</span>
	</label>

	<ul class="mb-6 space-y-3">
		{#each WORDS as w, i (w.model)}
			<li class="rounded-md border border-zinc-800 p-3">
				<div class="mb-2 flex items-baseline justify-between gap-3">
					<span class="font-semibold">{w.label}</span>
					<span class="text-xs text-zinc-400">
						{stats[i]!.right} bien · {stats[i]!.wrong} sin querer{hours > 0.05
							? ` (${stats[i]!.perHour.toFixed(1)}/h)`
							: ''}
					</span>
				</div>
				<!-- The score now, the recent highest, and the threshold. -->
				<div class="relative h-4 overflow-hidden rounded bg-zinc-800">
					<div
						class="absolute inset-y-0 left-0 bg-amber-500/30"
						style:width="{peaks[i]! * 100}%"
					></div>
					<div
						class={[
							'absolute inset-y-0 left-0',
							scores[i]! >= threshold ? 'bg-green-500' : 'bg-amber-500'
						]}
						style:width="{scores[i]! * 100}%"
					></div>
					<div class="absolute inset-y-0 w-0.5 bg-white/70" style:left="{threshold * 100}%"></div>
				</div>
			</li>
		{/each}
	</ul>

	{#if detections.length}
		<h2 class="mb-2 font-semibold">Detecciones</h2>
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
			{#each detections as d (d.id)}
				<li class="flex items-center gap-3 p-2">
					<span class="w-20 shrink-0 text-zinc-400 tabular-nums">{time.format(d.at)}</span>
					<span class="min-w-0 flex-1"
						>{d.word} <span class="text-zinc-500">{d.score.toFixed(2)}</span></span
					>
					<button
						class={[
							'rounded px-2 py-1',
							d.right === true ? 'bg-green-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700'
						]}
						onclick={() => (d.right = true)}>Bien</button
					>
					<button
						class={[
							'rounded px-2 py-1',
							d.right === false ? 'bg-red-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700'
						]}
						onclick={() => (d.right = false)}>Sin querer</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>
