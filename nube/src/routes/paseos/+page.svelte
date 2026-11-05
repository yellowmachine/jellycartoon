<script lang="ts">
	import { enhance } from '$app/forms';
	import TripMap from '#lib/components/TripMap.svelte';
	import { durationText, type StoredPoint } from '#lib/trips.ts';
	import { walkRecorder as walk } from '#lib/walk-recorder.svelte.ts';
	import { clockText, paceText, walkDistanceText, type WalkDiagnosis } from '#lib/walks.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const day = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
	const count = new Intl.NumberFormat('es');

	let now = $state(Date.now());
	$effect(() => {
		if (!walk.recording) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const elapsed = $derived(walk.startedAt === null ? 0 : (now - walk.startedAt) / 1000);

	const seconds = (w: { startedAt: Date; endedAt: Date }) =>
		(new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000;
	const gapSeconds = (d: WalkDiagnosis) => d.gaps.reduce((sum, g) => sum + g.seconds, 0);
	/** «45 s», «3 min». */
	const shortTime = (s: number) => (s < 60 ? `${s} s` : durationText(s));

	/** «Descartar», asked twice, without a dialog. */
	let sure = $state(false);

	function start() {
		sure = false;
		now = Date.now();
		walk.start();
	}

	/** The walk opened, and its way once it comes. */
	let opened = $state<number | null>(null);
	let line = $state<StoredPoint[] | null>(null);
	async function open(id: number) {
		if (opened === id) return void (opened = null);
		opened = id;
		line = null;
		const res = await fetch(`/paseos/${id}/recorrido`).catch(() => null);
		if (opened !== id || !res?.ok) return;
		line = (await res.json()).line;
	}
</script>

<svelte:head>
	<title>Paseos · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Paseos</h1>
<p class="mb-6 text-sm text-zinc-400">Tiempo, km y recorrido al salir a andar, solo para ti.</p>

<section class="mb-8 rounded-md border border-zinc-800 p-4">
	{#if walk.endedAt !== null}
		<p class="font-semibold">Paseo terminado, sin enviar</p>
		<p class="mb-3 text-sm text-zinc-300">
			{clockText((walk.endedAt - walk.startedAt!) / 1000)} · {walkDistanceText(walk.distance)}
		</p>
		<div class="flex flex-wrap items-center gap-3">
			<button
				class="rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50"
				disabled={walk.sending}
				onclick={() => walk.send()}>{walk.sending ? 'Enviando…' : 'Enviar'}</button
			>
			{@render discard()}
		</div>
	{:else if walk.recording}
		<p class="text-5xl font-semibold tabular-nums">{clockText(elapsed)}</p>
		<p class="mt-1 mb-4 text-lg text-zinc-300">
			{walkDistanceText(walk.distance)}{paceText(walk.distance, elapsed)
				? ` · ${paceText(walk.distance, elapsed)}`
				: ''}
		</p>
		{#if !walk.located && !walk.problem}
			<p class="mb-4 text-sm text-zinc-400">Buscando el GPS…</p>
		{/if}
		<div class="flex flex-wrap items-center gap-3">
			<button
				class="rounded-md bg-red-600 px-6 py-3 text-lg font-semibold text-white"
				onclick={() => walk.finish()}>Terminar</button
			>
			{@render discard()}
		</div>
	{:else}
		<button
			class="rounded-md bg-emerald-600 px-6 py-3 text-lg font-semibold text-white"
			onclick={start}>Empezar</button
		>
	{/if}
	{#if walk.problem}
		<p class="mt-3 text-sm text-amber-300" role="alert">{walk.problem}</p>
	{/if}
</section>

{#snippet discard()}
	{#if sure}
		<span class="text-sm text-red-300">¿Tirar este paseo?</span>
		<button
			class="text-sm text-red-400"
			onclick={() => {
				walk.discard();
				sure = false;
			}}>Sí, tirarlo</button
		>
		<button class="text-sm text-zinc-400" onclick={() => (sure = false)}>No</button>
	{:else}
		<button class="text-sm text-zinc-500 hover:text-red-400" onclick={() => (sure = true)}
			>Descartar</button
		>
	{/if}
{/snippet}

{#if data.walks.length}
	<section class="mb-8 grid grid-cols-2 gap-3">
		{#each [{ label: 'Esta semana', s: data.totals.week }, { label: 'Este mes', s: data.totals.month }] as box (box.label)}
			<div class="rounded-md border border-zinc-800 p-3">
				<p class="mb-1 text-sm text-zinc-400">{box.label}</p>
				<p class="text-xl font-semibold">{walkDistanceText(box.s.distance)}</p>
				<p class="text-sm text-zinc-300">
					{box.s.walks}
					{box.s.walks === 1 ? 'paseo' : 'paseos'} · {durationText(box.s.seconds)}
				</p>
			</div>
		{/each}
	</section>

	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.walks as w (w.id)}
			<li class="p-3">
				<div class="flex items-center gap-4">
					<button class="min-w-0 flex-1 text-left hover:text-amber-300" onclick={() => open(w.id)}>
						<span class="block font-medium">
							{day.format(new Date(w.startedAt))}, {time.format(new Date(w.startedAt))}
						</span>
						<span class="block text-sm text-zinc-400">
							{walkDistanceText(w.distance)} · {durationText(seconds(w))}{paceText(
								w.distance,
								seconds(w)
							)
								? ` · ${paceText(w.distance, seconds(w))}`
								: ''}
						</span>
						{#if w.diagnosis.gaps.length}
							<span class="block text-sm text-amber-300">
								GPS cortado {shortTime(gapSeconds(w.diagnosis))}: los km pueden quedarse cortos
							</span>
						{/if}
					</button>
					<form method="post" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={w.id} />
						<button class="text-sm text-zinc-500 hover:text-red-400">Borrar</button>
					</form>
				</div>
				{#if opened === w.id}
					<div class="mt-3">
						{#if w.points < 2}
							<p class="text-sm text-zinc-400">Sin recorrido: el GPS no dio posiciones.</p>
						{:else if !data.map}
							<p class="text-sm text-zinc-400">No hay mapa (scripts/mapa.sh).</p>
						{:else if line}
							<TripMap {line} />
						{:else}
							<p class="text-sm text-zinc-400">Cargando el recorrido…</p>
						{/if}
						<!-- The test of #410: whether the GPS goes on with the screen off. -->
						<div class="mt-3 text-sm text-zinc-400">
							<p>
								Posiciones del GPS: {count.format(w.diagnosis.fixes)}, {count.format(
									w.diagnosis.hiddenFixes
								)} con la pantalla apagada y {count.format(w.diagnosis.musicFixes)} con música.
							</p>
							<p>Pantalla apagada: {shortTime(w.diagnosis.hiddenSeconds)}.</p>
							{#if w.diagnosis.gaps.length}
								<ul class="mt-1 list-disc pl-5">
									{#each w.diagnosis.gaps as gap (gap.at)}
										<li>
											{time.format(new Date(gap.at * 1000))}: {shortTime(gap.seconds)} sin GPS, {gap.metres}
											m en línea recta{gap.hidden ? ', pantalla apagada' : ''}{gap.music
												? ', con música'
												: ''}{gap.reopened ? ', el móvil cerró la página' : ''}
										</li>
									{/each}
								</ul>
							{:else}
								<p>Sin cortes del GPS.</p>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else if !walk.recording && walk.endedAt === null}
	<p class="text-zinc-400">Todavía no hay paseos guardados.</p>
{/if}
