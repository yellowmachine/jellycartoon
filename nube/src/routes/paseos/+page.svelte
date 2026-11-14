<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import WalkLock from './WalkLock.svelte';
	import WalkShare from './WalkShare.svelte';
	import NoteButton from '#lib/components/NoteButton.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import WalkUploads from '#lib/components/WalkUploads.svelte';
	import { noteRecorder } from '#lib/note-recorder.svelte.ts';
	import type { Note } from '#lib/notes.ts';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import { durationText, type StoredPoint } from '#lib/trips.ts';
	import { walkRecorder as walk } from '#lib/walk-recorder.svelte.ts';
	import { walkUploads } from '#lib/walk-uploads.svelte.ts';
	import {
		CUE_EVERY,
		WALK_GOALS,
		clockText,
		goalKey,
		goalLeftText,
		goalText,
		paceText,
		photoCopyName,
		walkDistanceText,
		type CueEvery,
		type WalkDiagnosis
	} from '#lib/walks.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const day = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });

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

	/**
	 * The photo as it was taken, downloaded: a page cannot write to the gallery, and the camera gives
	 * it to the page without keeping its own. Stays on the phone whatever happens to what is sent.
	 */
	function keepCopy(file: File) {
		const url = URL.createObjectURL(file);
		const link = document.createElement('a');
		link.href = url;
		link.download = photoCopyName(new Date(), file.name);
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}

	/** A photo smaller, as the tickets': on the walk, where it was taken. */
	async function photo(input: HTMLInputElement) {
		const taken = input.files?.[0];
		input.value = '';
		walk.cameraCloses();
		if (!taken) return;
		keepCopy(taken);
		await walk.attach('foto', smallerPhoto(taken));
	}

	const select =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';

	/** The walk opened, and its way once it comes. */
	let opened = $state<number | null>(null);
	let line = $state<StoredPoint[] | null>(null);
	let photos = $state<{ id: number; lon: number | null; lat: number | null }[]>([]);
	let notes = $state<Note[]>([]);
	async function open(id: number) {
		if (opened === id) return void (opened = null);
		opened = id;
		line = null;
		photos = [];
		notes = [];
		const res = await fetch(`/paseos/${id}/recorrido`).catch(() => null);
		if (opened !== id || !res?.ok) return;
		({ line, photos, notes } = await res.json());
	}

	// Its photos and notes arrive after the walk: the one opened shows them as they do.
	$effect(() => {
		if (!walkUploads.arrived || opened === null) return;
		const id = opened;
		void fetch(`/paseos/${id}/recorrido`)
			.then((res) => (res.ok ? res.json() : null))
			.then((fresh) => {
				if (!fresh || opened !== id) return;
				photos = fresh.photos;
				notes = fresh.notes;
			})
			.catch(() => {});
	});
</script>

<svelte:head>
	<title>Paseos · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Paseos<GuideLink page="paseos" label="los paseos" /></h1>
<p class="mb-6 text-sm text-zinc-400">Tiempo, km y recorrido al salir a andar, solo para ti.</p>

<WalkUploads />

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
		{#if walk.notKept}
			<div class="mb-4 flex items-start gap-2 rounded-md bg-red-500/15 p-3 text-sm text-red-200">
				<p class="flex-1" role="alert">{walk.notKept}</p>
				<button class="px-1" aria-label="Cerrar el aviso" onclick={() => (walk.notKept = null)}
					>✕</button
				>
			</div>
		{/if}
		{#if walk.lostSeconds}
			<div
				class="mb-4 flex items-start gap-2 rounded-md bg-amber-500/15 p-3 text-sm text-amber-200"
			>
				<p class="flex-1" role="alert">
					Con la pantalla apagada o en otra app no se han medido {shortTime(walk.lostSeconds)}. La
					próxima vez, usa 🔒 «Bloquear pantalla».
				</p>
				<button class="px-1" aria-label="Cerrar el aviso" onclick={() => walk.forgetLost()}
					>✕</button
				>
			</div>
		{/if}
		<p class="text-5xl font-semibold tabular-nums">{clockText(elapsed)}</p>
		<p class="mt-1 mb-4 text-lg text-zinc-300">
			{walkDistanceText(walk.distance)}{paceText(walk.distance, elapsed)
				? ` · ${paceText(walk.distance, elapsed)}`
				: ''}
		</p>
		{#if walk.plan.goal}
			<p class="mb-4 text-sm text-zinc-300">
				Objetivo: {goalText(walk.plan.goal)} · {goalLeftText(
					walk.plan.goal,
					walk.distance,
					elapsed
				) ?? 'conseguido'}
			</p>
		{/if}
		{#if !walk.located && !walk.problem}
			<p class="mb-4 text-sm text-zinc-400">Buscando el GPS…</p>
		{/if}
		<WalkLock onlock={() => walk.forgetLost()} />
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<label class="cursor-pointer rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700">
				📷 Foto
				<input
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onclick={() => walk.cameraOpens()}
					oncancel={() => walk.cameraCloses()}
					onchange={(e) => photo(e.currentTarget)}
				/>
			</label>
			<NoteButton
				onrecorded={(audio) => walk.attach('nota', audio)}
				class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700"
			/>
			{#if walk.photos || walk.notes}
				<span class="text-sm text-zinc-400">
					{walk.photos === 1 ? '1 foto' : `${walk.photos} fotos`} ·
					{walk.notes === 1 ? '1 nota' : `${walk.notes} notas`}
				</span>
			{/if}
		</div>
		{#if noteRecorder.problem}
			<p class="mt-3 text-sm text-amber-300" role="alert">{noteRecorder.problem}</p>
		{/if}
		<div class="mt-8 flex flex-wrap items-center gap-3">
			<button
				class="rounded-md bg-red-600 px-4 py-2 font-semibold text-white"
				onclick={() => walk.finish()}>Terminar</button
			>
			{@render discard()}
		</div>
		<p class="mt-3 text-sm text-zinc-400">
			«Bloquear pantalla» la deja en negro y encendida: baja antes el brillo, porque gasta batería.
			Cada foto se descarga también en el móvil, en Descargas.
		</p>
	{:else}
		<div class="mb-4 flex flex-wrap gap-3">
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Avisos por voz
				<select
					class={select}
					value={walk.plan.every ?? ''}
					onchange={(e) =>
						walk.choose({ every: (e.currentTarget.value || null) as CueEvery | null })}
				>
					<option value="">Sin avisos</option>
					{#each Object.entries(CUE_EVERY) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Objetivo
				<select
					class={select}
					value={walk.plan.goal ? goalKey(walk.plan.goal) : ''}
					onchange={(e) => {
						const key = e.currentTarget.value;
						walk.choose({ goal: WALK_GOALS.find((g) => goalKey(g) === key) ?? null });
					}}
				>
					<option value="">Sin objetivo</option>
					{#each WALK_GOALS as g (goalKey(g))}
						<option value={goalKey(g)}>{goalText(g)}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if walk.plan.goal}
			<p class="mb-4 text-sm text-zinc-400">
				Te avisa por voz a mitad de objetivo, para dar la vuelta, y al llegar.
			</p>
		{/if}
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
								GPS cortado {shortTime(gapSeconds(w.diagnosis))}: los km pueden quedarse cortos{w.diagnosis.gaps.some(
									(gap) => gap.hidden
								)
									? '. Con la pantalla apagada no se miden bien: usa «Bloquear pantalla»'
									: ''}
							</span>
						{/if}
					</button>
					<ConfirmForm
						action="?/delete"
						fields={{ id: w.id }}
						label="Borrar"
						question="¿Borrar este paseo y sus fotos? Sus notas se quedan."
						class="text-sm text-zinc-500 hover:text-red-400"
					/>
				</div>
				{#if opened === w.id}
					<div class="mt-3">
						{#if w.points < 2}
							<p class="text-sm text-zinc-400">Sin recorrido: el GPS no dio posiciones.</p>
						{:else if !data.map}
							<p class="text-sm text-zinc-400">No hay mapa (scripts/mapa.sh).</p>
						{:else if line}
							<TripMap {line} {photos} photoBase="/paseos/fotos" />
						{:else}
							<p class="text-sm text-zinc-400">Cargando el recorrido…</p>
						{/if}
						{#if photos.length}
							<div class="mt-3 grid grid-cols-3 gap-2">
								{#each photos as p (p.id)}
									<a href="/paseos/fotos/{p.id}" target="_blank" rel="noreferrer">
										<img
											src="/paseos/fotos/{p.id}"
											alt="Foto del paseo"
											loading="lazy"
											class="aspect-square w-full rounded object-cover"
										/>
									</a>
								{/each}
							</div>
						{/if}
						{#if notes.length}
							<ul class="mt-3 flex flex-col gap-3 text-sm">
								{#each notes as n (n.id)}
									<li>
										<span class="text-zinc-500">{time.format(new Date(n.at))}</span>
										{n.hearing === 'ready'
											? n.text || '(sin palabras)'
											: n.hearing === 'pending'
												? 'Transcribiendo…'
												: 'No se pudo transcribir'}
										{#if n.hasAudio}
											<audio controls preload="none" src="/notas/{n.id}/audio" class="mt-1 w-full"
											></audio>
										{/if}
									</li>
								{/each}
							</ul>
							<a href="/notas" class="mt-1 inline-block text-sm text-amber-400 hover:underline"
								>Corregirlas en Notas</a
							>
						{/if}
						<WalkShare walkId={w.id} {photos} />
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else if !walk.recording && walk.endedAt === null}
	<p class="text-zinc-400">Todavía no hay paseos guardados.</p>
{/if}
