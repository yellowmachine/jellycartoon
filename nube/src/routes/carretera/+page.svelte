<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { coverUrl, setMusicUrls, type MusicTrack } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { STATIONS, type RadioStation } from 'comun/radio.ts';
	import { keepScreenOn } from 'comun/screen-on.ts';
	import type { MusicPass } from '#lib/server/music.ts';
	import type { PageProps } from './$types';

	/**
	 * The road mode (#253), as jellycartoon's (#78), for now only its music: what plays, big; and
	 * one touch to put on a station, an album or a list. The house's songs and covers, straight from
	 * it by the pass; the screen stays on.
	 */

	let { data }: PageProps = $props();

	type Tab = 'radio' | 'musica' | 'listas';
	/**
	 * Inicio (`null`), with what plays and a big button for each section; or a section, its list
	 * filling it, with «← Inicio». Putting something on goes back to Inicio by itself.
	 */
	let tab = $state<Tab | null>(null);
	let loading = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let screenProblem = $state<string | null>(null);
	/** Logos that did not load: the station's initial instead. */
	const broken = new SvelteSet<string>();

	$effect(() => keepScreenOn((text) => (screenProblem = text)));

	/** The house's songs and covers, by the pass; a new one every few hours (it lasts 12). */
	function usePass(pass: MusicPass) {
		setMusicUrls({
			track: (id) => `${pass.base}/pistas/${id}`,
			cover: (albumId) => `${pass.base}/portadas/${albumId}`
		});
	}
	$effect(() => {
		if (!data.pass) return;
		usePass(data.pass);
		const renew = setInterval(async () => {
			const res = await fetch('/api/musica/pase', { method: 'POST' }).catch(() => null);
			if (res?.ok) usePass(await res.json());
		}, 6 * 3_600_000);
		return () => clearInterval(renew);
	});

	/** What is on, as the big card shows it. */
	const playing = $derived(
		music.radio
			? { title: music.radio.name, detail: 'Radio en directo', image: music.radio.favicon }
			: music.current
				? {
						title: music.current.title,
						detail: `${music.current.artist} · ${music.current.album}`,
						image: music.current.hasCover ? coverUrl(music.current.albumId) : null
					}
				: null
	);
	/** How far into the song, to see at a glance; a station has none. */
	const progress = $derived.by(() => {
		if (music.radio || !playing) return null;
		const duration = music.durationSec ?? music.current?.durationSec;
		return duration ? { at: Math.min(music.positionSec, duration), duration } : null;
	});

	async function busy(id: string, work: () => Promise<string | null | void>) {
		loading = id;
		problem = (await work()) ?? null;
		loading = null;
		// On: back to Inicio, as in the car's own screens.
		if (!problem) tab = null;
	}

	function radio(station: RadioStation) {
		if (music.radio?.uuid === station.uuid) return music.toggle();
		return busy(station.uuid, async () => {
			await musicTarget.playRadio(station.uuid, false);
			return musicTarget.error;
		});
	}

	/**
	 * What the music playing was put on from here (an album, «Todo aleatorio», a list): an album is
	 * «Sonando» when it was put on, not because a random track is from it.
	 */
	let playingFrom = $state<string | null>(null);
	const playingHere = (id: string) =>
		playingFrom === id && Boolean(music.current) && !music.radio && !music.podcast;

	/** Tracks asked for when put on, not all of them with the page. */
	function playFrom(id: string, url: string, empty: string) {
		if (playingHere(id)) return music.toggle();
		return busy(id, async () => {
			const res = await fetch(url).catch(() => null);
			if (!res?.ok) return 'No se pudo cargar: ¿está la casa encendida?';
			const tracks: MusicTrack[] = await res.json();
			if (!tracks.length) return empty;
			music.play(tracks, 0);
			playingFrom = id;
		});
	}

	const list = (id: number) =>
		playFrom(`lista-${id}`, `/carretera/listas/${id}`, 'La lista está vacía.');

	const album = (id: number) =>
		playFrom(`album-${id}`, `/carretera/album/${id}`, 'El álbum está vacío.');

	const everything = () => playFrom('aleatorio', '/carretera/aleatorio', 'No hay música.');

	// Spanish first, as in jellycartoon: it is the house's own.
	const stations = [...STATIONS].sort(
		(a, b) => Number(b.language === 'es') - Number(a.language === 'es')
	);

	/** Drawn, so they are seen at a glance; their names for whoever does not see them. */
	const TABS: { id: Tab; label: string }[] = $derived([
		{ id: 'radio', label: 'Radio' },
		...(data.pass
			? [
					{ id: 'musica' as const, label: 'Música' },
					{ id: 'listas' as const, label: 'Listas' }
				]
			: [])
	]);

	const big =
		'flex shrink-0 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-100 active:scale-95 active:bg-zinc-700 disabled:opacity-40';
	const tile =
		'flex min-h-20 items-center gap-3 rounded-2xl border-2 p-3 text-left active:scale-[0.98]';
</script>

<svelte:head>
	<title>Carretera · Nube</title>
</svelte:head>

{#snippet tabIcon(id: Tab)}
	{#if id === 'radio' || id === 'musica'}
		<SectionIcon name={id} class="h-8 w-8" />
	{:else}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-8 w-8"
			aria-hidden="true"
		>
			<path d="M4 6h11M4 11h11M4 16h7" />
			<path d="M18 19.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM18 19.5V9l3-1" />
		</svg>
	{/if}
{/snippet}

<div class="flex min-h-dvh flex-col gap-4 bg-zinc-950 text-zinc-100 select-none">
	{#if tab === null}
		<!-- Inicio: what plays, big, and its controls; then a big button for each section. -->
		<section class="rounded-2xl bg-zinc-900 p-4">
			<div class="flex items-center gap-4">
				<a
					href="/"
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-2xl text-zinc-300 active:bg-zinc-700"
					aria-label="Salir del modo carretera"
					title="Salir">←</a
				>
				{#if playing}
					{#if playing.image}
						<img
							src={playing.image}
							alt=""
							class="h-20 w-20 shrink-0 rounded-xl bg-zinc-800 object-cover"
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate text-2xl font-semibold">{playing.title}</p>
						<p class="truncate text-lg text-zinc-400">{playing.detail}</p>
					</div>
					{#if progress}
						<div class="min-w-20 shrink-0">
							<p class="text-right font-mono text-base text-zinc-300 tabular-nums">
								{formatDuration(progress.at) || '0:00'}<span class="text-zinc-500"
									>/{formatDuration(progress.duration)}</span
								>
							</p>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
								<div
									class="h-full rounded-full bg-amber-500"
									style:width="{(progress.at / progress.duration) * 100}%"
								></div>
							</div>
						</div>
					{/if}
				{:else}
					<p class="min-w-0 flex-1 py-4 text-center text-xl text-zinc-400">
						No suena nada. Elige abajo.
					</p>
				{/if}
			</div>
			{#if playing}
				<div class="mt-4 flex items-center justify-center gap-4">
					{#if !music.radio}
						<button class="{big} h-20 w-20" aria-label="Anterior" onclick={() => music.previous()}
							><MediaIcon name="previous" class="h-9 w-9" /></button
						>
					{/if}
					<button
						class="{big} h-24 w-24 bg-amber-500! text-zinc-950!"
						aria-label={music.playing ? 'Pausa' : 'Seguir'}
						onclick={() => music.toggle()}
						><MediaIcon name={music.playing ? 'pause' : 'play'} class="h-12 w-12" /></button
					>
					{#if !music.radio}
						<button
							class="{big} h-20 w-20"
							aria-label="Siguiente"
							disabled={music.index >= music.queue.length - 1 && !music.repeat}
							onclick={() => music.next()}><MediaIcon name="next" class="h-9 w-9" /></button
						>
					{/if}
				</div>
			{/if}
		</section>

		{#if data.problem}
			<p class="rounded-xl bg-amber-950 p-3 text-amber-200">
				Sin la música de casa: {data.problem} La radio sí funciona.
			</p>
		{/if}
		{#if problem}
			<p class="rounded-xl bg-red-950 p-3 text-red-200">{problem}</p>
		{/if}
		{#if screenProblem}
			<p class="text-base text-zinc-400">{screenProblem}</p>
		{/if}

		<!-- A big button for each section: one touch, and its list. -->
		<nav class="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Secciones">
			{#each TABS as t (t.id)}
				<button
					class="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-zinc-900 text-lg font-semibold text-zinc-200 active:scale-95 active:bg-zinc-800"
					onclick={() => (tab = t.id)}>{@render tabIcon(t.id)}{t.label}</button
				>
			{/each}
		</nav>
	{:else}
		<!-- In a section: the way back, big; and what plays, to pause it. -->
		<div class="flex items-center gap-3">
			<button class="{big} h-16 gap-2 px-5 text-xl font-semibold" onclick={() => (tab = null)}
				>← Inicio</button
			>
			<div class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-zinc-900 p-2">
				{#if playing}
					<span class="min-w-0 flex-1 truncate pl-2 text-lg">{playing.title}</span>
					<button
						class="{big} h-12 w-12 bg-amber-500! text-zinc-950!"
						aria-label={music.playing ? 'Pausa' : 'Seguir'}
						onclick={() => music.toggle()}
						><MediaIcon name={music.playing ? 'pause' : 'play'} class="h-7 w-7" /></button
					>
				{:else}
					<span class="min-w-0 flex-1 truncate pl-2 text-lg text-zinc-400">
						{TABS.find((t) => t.id === tab)?.label}
					</span>
				{/if}
			</div>
		</div>

		{#if problem}
			<p class="rounded-xl bg-red-950 p-3 text-red-200">{problem}</p>
		{/if}

		<div
			class="grid grid-cols-1 content-start gap-3 sm:grid-cols-2"
			role="region"
			aria-label={TABS.find((t) => t.id === tab)?.label}
		>
			{#if tab === 'radio'}
				{#each stations as station (station.uuid)}
					{@const favicon = data.info?.[station.uuid]?.favicon}
					{@const on = music.radio?.uuid === station.uuid}
					<button
						class={[
							tile,
							on ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 bg-zinc-900'
						]}
						disabled={loading !== null}
						onclick={() => radio(station)}
					>
						{#if favicon && !broken.has(station.uuid)}
							<img
								src={favicon}
								alt=""
								class="h-14 w-14 shrink-0 rounded-lg bg-white object-contain p-1"
								onerror={() => broken.add(station.uuid)}
							/>
						{:else}
							<span
								class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-2xl font-bold text-zinc-400"
								>{station.name[0]}</span
							>
						{/if}
						<span class="min-w-0">
							<span class="block truncate text-xl font-semibold">
								{loading === station.uuid ? 'Conectando…' : station.name}
							</span>
							<span class="block truncate text-base text-zinc-400"
								>{on ? (music.playing ? '● Sonando' : 'En pausa') : station.description}</span
							>
						</span>
					</button>
				{/each}
			{:else if tab === 'musica'}
				{@const shuffling = playingHere('aleatorio')}
				<button
					class={[
						tile,
						'sm:col-span-2',
						shuffling
							? 'border-emerald-400 bg-emerald-500/15'
							: 'border-amber-400/60 bg-amber-500/10'
					]}
					disabled={loading !== null}
					onclick={everything}
				>
					<span
						class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-amber-300"
						><MediaIcon name="shuffle" class="h-8 w-8" /></span
					>
					<span class="min-w-0">
						<span class="block truncate text-xl font-semibold">
							{loading === 'aleatorio' ? 'Cargando…' : 'Todo aleatorio'}
						</span>
						<span class="block truncate text-base text-zinc-400"
							>{shuffling ? (music.playing ? '● Sonando' : 'En pausa') : 'De toda tu música'}</span
						>
					</span>
				</button>
				{#each data.albums as a (a.id)}
					{@const on = playingHere(`album-${a.id}`)}
					<button
						class={[
							tile,
							on ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 bg-zinc-900'
						]}
						disabled={loading !== null}
						onclick={() => album(a.id)}
					>
						{#if a.hasCover}
							<img
								src={coverUrl(a.id)}
								alt=""
								loading="lazy"
								class="h-14 w-14 shrink-0 rounded-lg bg-zinc-800 object-cover"
							/>
						{:else}
							<span
								class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-2xl font-bold text-zinc-400"
								>{a.title[0]}</span
							>
						{/if}
						<span class="min-w-0">
							<span class="block truncate text-xl font-semibold">
								{loading === `album-${a.id}` ? 'Cargando…' : a.title}
							</span>
							<span class="block truncate text-base text-zinc-400"
								>{on ? (music.playing ? '● Sonando' : 'En pausa') : a.artist}</span
							>
						</span>
					</button>
				{:else}
					<p class="text-lg text-zinc-400">No hay música todavía.</p>
				{/each}
			{:else if tab === 'listas'}
				{#each data.playlists as playlist (playlist.id)}
					<button
						class="{tile} border-white/10 bg-zinc-900"
						disabled={loading !== null}
						onclick={() => list(playlist.id)}
					>
						<span class="min-w-0">
							<span class="block truncate text-xl font-semibold">
								{loading === `lista-${playlist.id}` ? 'Cargando…' : playlist.name}
							</span>
							<span class="block text-base text-zinc-400">{playlist.total} canciones</span>
						</span>
					</button>
				{:else}
					<p class="text-lg text-zinc-400">No hay listas. Se hacen en Música, en casa.</p>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<!-- Its two <audio>, the queue and the lock screen's controls, as in jellycartoon; its bar, not here. -->
<div class="hidden"><MusicBar /></div>
