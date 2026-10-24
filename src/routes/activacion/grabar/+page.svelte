<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { peakLevel, record, toWav, type Recorder } from '#lib/wakeword-recorder.ts';
	import { speakerSlug } from '#lib/wakeword-samples.ts';

	/**
	 * Recording the house's voices for «candy candy» (#144, phase 3): each take, 2.5 s from the tap,
	 * kept on the server to train the model with real voices (the synthetic ones are not enough).
	 * The word itself, said in different ways, and phrases like it, for it not to go off with them.
	 */
	let { data } = $props();

	const TAKE_MS = 2500;
	/** Quieter than this, nothing was said. */
	const SILENT_DB = -50;
	/** Per person, for a start. */
	const GOAL = 30;
	const WAYS = [
		'normal',
		'bajito',
		'más fuerte',
		'rápido',
		'despacio',
		'desde lejos (2 o 3 metros)',
		'de espaldas al móvil',
		'con la tele puesta',
		'como una pregunta',
		'cantando un poco'
	];
	const SIMILAR = [
		'Sandy Sandy',
		'candy',
		'canta canta',
		'anda anda',
		'mamá mamá',
		'papá papá',
		'dame dame',
		'Andy Andy',
		'venga venga',
		'mira mira',
		'Mandy Mandy',
		'cámara',
		'caramelo'
	];
	const KINDS = [
		{ id: 'candy_candy', label: 'Candy candy' },
		{ id: 'parecidas', label: 'Frases parecidas' }
	] as const;
	type KindId = (typeof KINDS)[number]['id'];
	type Take = { id: number; kind: KindId; who: string; name: string; text: string; url: string };

	const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]!;
	const stored = (() => {
		try {
			return localStorage.getItem('palabra-quien') ?? '';
		} catch {
			return '';
		}
	})();

	let who = $state(stored);
	let kind = $state<KindId>('candy_candy');
	let hint = $state(pick(WAYS));
	let status = $state<'off' | 'ready' | 'recording' | 'saving'>('off');
	let problem = $state<string | null>(null);
	let level = $state(-90);
	let progress = $state(0);
	let takes = $state<Take[]>([]);
	let nextId = 1;
	let context: AudioContext | null = null;
	let recorder: Recorder | null = null;
	let ticker: ReturnType<typeof setInterval> | undefined;

	const prompt = $derived(kind === 'candy_candy' ? `«Candy candy», ${hint}` : `«${hint}»`);
	const speakers = $derived(
		Object.entries(data.counts).sort(([a], [b]) => a.localeCompare(b, 'es'))
	);

	function choose(k: KindId) {
		kind = k;
		hint = pick(k === 'candy_candy' ? WAYS : SIMILAR);
	}

	async function take() {
		problem = null;
		if (!who.trim()) {
			problem = 'Escribe primero quién habla.';
			return;
		}
		try {
			localStorage.setItem('palabra-quien', who.trim());
		} catch {
			// Only a convenience.
		}
		try {
			if (!recorder) {
				// Now, on the tap: Android leaves an AudioContext made later suspended.
				context = new AudioContext();
				recorder = await record(context, true, (db) => (level = Math.max(db, level - 1.5)));
			}
			status = 'recording';
			const started = Date.now();
			progress = 0;
			ticker = setInterval(() => (progress = Math.min(1, (Date.now() - started) / TAKE_MS)), 50);
			const samples = await recorder.take(TAKE_MS);
			clearInterval(ticker);
			if (peakLevel(samples) < SILENT_DB) {
				status = 'ready';
				problem = 'No se oye nada: acércate un poco y otra vez.';
				return;
			}
			status = 'saving';
			const wav = toWav(samples);
			const text = prompt;
			const speaker = who.trim();
			const params = new URLSearchParams({ tipo: kind, quien: speaker });
			const res = await fetch(`/api/palabra?${params}`, { method: 'POST', body: wav });
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
			const { name } = (await res.json()) as { name: string };
			const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
			takes = [{ id: nextId++, kind, who: speaker, name, text, url }, ...takes];
			hint = pick(kind === 'candy_candy' ? WAYS : SIMILAR);
			status = 'ready';
			void invalidateAll();
		} catch (err) {
			clearInterval(ticker);
			status = recorder ? 'ready' : 'off';
			problem = err instanceof Error ? err.message : String(err);
		}
	}

	async function undo(t: Take) {
		const params = new URLSearchParams({ tipo: t.kind, quien: t.who, nombre: t.name });
		const res = await fetch(`/api/palabra?${params}`, { method: 'DELETE' });
		if (!res.ok) {
			problem = 'No se pudo borrar';
			return;
		}
		URL.revokeObjectURL(t.url);
		takes = takes.filter((x) => x.id !== t.id);
		void invalidateAll();
	}

	function play(t: Take) {
		void new Audio(t.url).play();
	}

	onDestroy(() => {
		clearInterval(ticker);
		recorder?.stop();
		if (context && context.state !== 'closed') void context.close();
		for (const t of takes) URL.revokeObjectURL(t.url);
	});
</script>

<svelte:head>
	<title>Grabar la palabra · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-xl">
	<a href="/activacion" class="text-sm text-amber-400 hover:underline">← Palabra de activación</a>
	<h1 class="mt-2 mb-1 text-2xl font-bold">Grabar «candy candy»</h1>
	<p class="mb-4 text-sm text-zinc-400">
		Vuestras voces, para entrenar el modelo con ellas: las voces sintéticas no suenan como nosotros.
		Pulsa «Grabar» y di lo que pone en los 2,5 segundos siguientes; cada vez pide una forma
		distinta. Unas {GOAL} por persona, peques incluidos, y algunas frases parecidas. Se guardan solo en
		el servidor de casa.
	</p>

	<label class="mb-3 block text-sm">
		<span class="mb-1 block text-zinc-300">Quién habla</span>
		<input
			bind:value={who}
			maxlength="40"
			placeholder="Por ejemplo: papá, Lucía (6)"
			class="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2"
		/>
	</label>
	{#if speakers.length}
		<div class="mb-4 flex flex-wrap gap-2 text-sm">
			{#each speakers as [name, count] (name)}
				<button
					class={[
						'rounded-full px-3 py-1',
						name === speakerSlug(who)
							? 'bg-amber-500 text-zinc-950'
							: 'bg-zinc-800 hover:bg-zinc-700'
					]}
					onclick={() => (who = name)}
				>
					{name} · {count.candy_candy ?? 0}/{GOAL}{count.parecidas
						? ` · ${count.parecidas} parecidas`
						: ''}
				</button>
			{/each}
		</div>
	{/if}

	<div class="mb-4 flex gap-2">
		{#each KINDS as k (k.id)}
			<button
				class={[
					'flex-1 rounded-md px-3 py-2 text-sm font-medium',
					kind === k.id ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'
				]}
				onclick={() => choose(k.id)}>{k.label}</button
			>
		{/each}
	</div>

	<div class="mb-4 rounded-md border border-zinc-800 p-4 text-center">
		<p class="mb-1 text-xs text-zinc-400">Di:</p>
		<p class="mb-4 text-xl font-semibold">{prompt}</p>
		<button
			class={[
				'w-full rounded-md px-4 py-3 text-lg font-medium disabled:opacity-60',
				status === 'recording'
					? 'bg-red-600 text-white'
					: 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
			]}
			disabled={status === 'recording' || status === 'saving'}
			onclick={take}
		>
			{status === 'recording' ? '¡Ahora!' : status === 'saving' ? 'Guardando…' : 'Grabar'}
		</button>
		<div class="mt-3 h-2 overflow-hidden rounded bg-zinc-800">
			{#if status === 'recording'}
				<div class="h-full bg-red-500" style:width="{progress * 100}%"></div>
			{:else}
				<div class="h-full bg-sky-500" style:width="{Math.max(0, (level + 90) / 90) * 100}%"></div>
			{/if}
		</div>
		{#if kind === 'candy_candy'}
			<button class="mt-3 text-xs text-zinc-400 hover:underline" onclick={() => (hint = pick(WAYS))}
				>Otra forma</button
			>
		{:else}
			<button
				class="mt-3 text-xs text-zinc-400 hover:underline"
				onclick={() => (hint = pick(SIMILAR))}>Otra frase</button
			>
		{/if}
	</div>
	{#if problem}
		<p class="mb-4 text-sm text-red-400">{problem}</p>
	{/if}

	{#if takes.length}
		<h2 class="mb-2 font-semibold">Grabadas ahora</h2>
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
			{#each takes as t (t.id)}
				<li class="flex items-center gap-3 p-2">
					<span class="min-w-0 flex-1 truncate"
						>{t.text} <span class="text-zinc-500">· {t.who}</span></span
					>
					<button class="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700" onclick={() => play(t)}
						>Oír</button
					>
					<button class="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700" onclick={() => undo(t)}
						>Borrar</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>
