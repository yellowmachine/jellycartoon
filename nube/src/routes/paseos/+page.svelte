<script lang="ts">
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import WalkLock from './WalkLock.svelte';
	import NoteButton from '#lib/components/NoteButton.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import { noteRecorder } from '#lib/note-recorder.svelte.ts';
	import type { Note } from '#lib/notes.ts';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import { durationText, type StoredPoint } from '#lib/trips.ts';
	import { walkRecorder as walk } from '#lib/walk-recorder.svelte.ts';
	import { offlineMusic } from '#lib/offline-music.svelte.ts';
	import { playWalkList } from '#lib/walk-music.ts';
	import {
		CUE_EVERY,
		WALK_GOALS,
		clockText,
		goalKey,
		goalLeftText,
		goalText,
		paceText,
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

	/**
	 * The house's lists, asked for once and only when a walk can start, not with the page (its key
	 * has a limit), and those this device carries, which need no coverage.
	 */
	let houseLists = $state<{ id: number; name: string }[]>([]);
	let listsAsked = false;
	$effect(() => {
		if (walk.startedAt !== null || listsAsked) return;
		listsAsked = true;
		void fetch('/paseos/musica')
			.then((res) => (res.ok ? res.json() : []))
			.then((lists) => (houseLists = lists))
			.catch(() => {});
	});
	const lists = $derived.by(() => {
		const carried = new Set(offlineMusic.lists.map((l) => l.id));
		return [
			...offlineMusic.lists.map((l) => ({ id: l.id, name: `${l.name} (sin conexión)` })),
			...houseLists.filter((l) => !carried.has(l.id))
		];
	});
	/** Why the music did not start: the walk goes on all the same. */
	let musicProblem = $state<string | null>(null);

	function start() {
		sure = false;
		musicProblem = null;
		now = Date.now();
		walk.start();
		const list = lists.find((l) => l.id === walk.plan.list);
		if (list) void playWalkList(list.id).then((problem) => (musicProblem = problem));
	}

	/** A photo smaller, as the tickets': on the walk, where it was taken. */
	async function photo(input: HTMLInputElement) {
		const taken = input.files?.[0];
		input.value = '';
		if (taken) await walk.attach('foto', await smallerPhoto(taken));
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
		<div class="flex flex-wrap items-center gap-3">
			<button
				class="rounded-md bg-red-600 px-6 py-3 text-lg font-semibold text-white"
				onclick={() => walk.finish()}>Terminar</button
			>
			<WalkLock />
			{@render discard()}
		</div>
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<label class="cursor-pointer rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700">
				📷 Foto
				<input
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
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
		<p class="mt-3 text-sm text-zinc-400">
			Con la pantalla apagada, el GPS no graba. «Bloquear pantalla» la deja en negro y encendida
			para el bolsillo: baja antes el brillo, gasta batería, y no pulses el botón de encendido.
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
			{#if lists.length}
				<label class="flex min-w-0 flex-col gap-1 text-xs text-zinc-400">
					Música
					<select
						class="{select} max-w-full"
						value={lists.some((l) => l.id === walk.plan.list) ? String(walk.plan.list) : ''}
						onchange={(e) =>
							walk.choose({ list: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
					>
						<option value="">Sin música</option>
						{#each lists as l (l.id)}
							<option value={String(l.id)}>{l.name}</option>
						{/each}
					</select>
				</label>
			{/if}
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
	{#if musicProblem}
		<p class="mt-3 text-sm text-amber-300" role="alert">{musicProblem}</p>
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
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else if !walk.recording && walk.endedAt === null}
	<p class="text-zinc-400">Todavía no hay paseos guardados.</p>
{/if}
