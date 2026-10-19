<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import MediaIcon from '#lib/components/MediaIcon.svelte';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import ManeuverIcon from '#lib/components/ManeuverIcon.svelte';
	import RoadMap from '#lib/components/RoadMap.svelte';
	import type { MusicTrack } from '#lib/music.ts';
	import { coverUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicQuality } from '#lib/music-quality.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { playEpisode } from '#lib/podcast-player.svelte.ts';
	import { SKIP_BACK, SKIP_FORWARD } from '#lib/podcasts.ts';
	import { STATIONS, type RadioStation } from '#lib/radio.ts';
	import { keepScreenOn } from '#lib/screen-on.ts';
	import { roadPhotos } from '#lib/road-photos.svelte.ts';
	import { tripRecorder } from '#lib/trip-recorder.svelte.ts';
	import { tripShare } from '#lib/trip-share.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { distanceText, type LngLat, type Place, type Route } from '#lib/road.ts';
	import { alongLine, guide } from '#lib/road-guide.ts';
	import { toSay } from '#lib/road-voice.ts';
	import type { PageProps } from './$types';

	/**
	 * The road mode (#78): the tablet by the steering wheel, in half of the screen beside the
	 * navigator (Android's split screen). Only sound: what plays, big; the microphone, bigger; and
	 * one touch to put on a station, a list or a podcast. The screen stays on.
	 */

	let { data }: PageProps = $props();

	type Tab = 'radio' | 'listas' | 'podcasts' | 'ruta';
	let tab = $state<Tab>('radio');
	let loading = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let screenProblem = $state<string | null>(null);
	/** Logos that did not load: the station's initial instead. */
	const broken = new SvelteSet<string>();

	$effect(() => keepScreenOn((text) => (screenProblem = text)));

	// The trip kept while this is open, for whoever turned it on (#81).
	$effect(() => {
		if (!data.recordTrips) return;
		untrack(() => tripRecorder.start(() => destination?.label ?? null));
		return () => tripRecorder.stop();
	});

	/**
	 * The map (phase 3a), on the left with the screen wide enough: the tablet whole, sideways. In
	 * half of it (Android's split screen, the navigator beside) it is not even made, nor the GPS asked.
	 */
	let wide = $state(false);
	let showMap = $state(true);
	$effect(() => {
		const query = matchMedia('(min-width: 768px)');
		const update = () => (wide = query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});
	const mapShown = $derived(data.map && wide && showMap);

	// The voice knows it is in the car: no video, no house's speakers, short answers; and it can
	// ask for a route («llévame a…») or say where we are, from here.
	$effect(() => {
		voice.road = {
			position: () => here,
			navigation: () =>
				destination && route
					? `a ${destination.label}, quedan ${distanceText(guidance?.remaining ?? route.distance)}`
					: null,
			navigate: (place) => {
				if (!place) return clearRoute();
				if (mapShown) tab = 'ruta';
				void go(place);
			},
			photo: () => void roadPhotos.take()
		};
		return () => {
			voice.road = null;
		};
	});

	/** What is on, as the big card shows it. */
	const playing = $derived(
		music.radio
			? { title: music.radio.name, detail: 'Radio en directo', image: music.radio.favicon }
			: music.podcast
				? {
						title: music.podcast.title,
						detail: music.podcast.podcastTitle,
						image: music.podcast.imageUrl
					}
				: music.current
					? {
							title: music.current.title,
							detail: `${music.current.artist} · ${music.current.album}`,
							image: music.current.hasCover ? coverUrl(music.current.albumId) : null
						}
					: null
	);

	async function busy(id: string, work: () => Promise<string | null | void>) {
		loading = id;
		problem = (await work()) ?? null;
		loading = null;
	}

	function radio(station: RadioStation) {
		if (music.radio?.uuid === station.uuid) return music.toggle();
		return busy(station.uuid, async () => {
			await musicTarget.playRadio(station.uuid, false);
			return musicTarget.error;
		});
	}

	function list(id: number) {
		return busy(`lista-${id}`, async () => {
			const res = await fetch(`/carretera/listas/${id}`).catch(() => null);
			if (!res?.ok) return 'No se pudo cargar la lista.';
			const tracks: MusicTrack[] = await res.json();
			if (!tracks.length) return 'La lista está vacía.';
			music.play(tracks, 0);
		});
	}

	function podcast(episodeId: number) {
		if (music.podcast?.id === episodeId) return music.toggle();
		return busy(`podcast-${episodeId}`, () => playEpisode(episodeId));
	}

	function release() {
		if (!micMode.tap) voice.stop();
	}

	/** Held down, or (Ajustes) a tap to start and another to send. */
	function press() {
		if (micMode.tap) voice.toggle();
		else void voice.start();
	}

	// Spanish first, as in the TV view: it is the house's own.
	const stations = [...STATIONS].sort(
		(a, b) => Number(b.language === 'es') - Number(a.language === 'es')
	);

	const TABS: { id: Tab; label: string }[] = $derived([
		{ id: 'radio', label: 'Radio' },
		{ id: 'listas', label: 'Listas' },
		{ id: 'podcasts', label: 'Podcasts' },
		// Only with the map beside, where the route is drawn.
		...(mapShown ? [{ id: 'ruta' as const, label: 'Ruta' }] : [])
	]);

	/**
	 * The route (phase 3b): the destination searched by its name, and the way there by car with its
	 * steps, from openrouteservice through the server (/carretera/buscar, /carretera/ruta).
	 */
	let here = $state<LngLat | null>(null);
	/** m/s, as the GPS says it: how far ahead the directions are said. */
	let speed = $state<number | null>(null);
	let query = $state('');
	let places = $state<Place[] | null>(null);
	let route = $state<Route | null>(null);
	let destination = $state<Place | null>(null);
	let routeProblem = $state<string | null>(null);
	let routeBusy = $state<'search' | 'route' | 'reroute' | null>(null);

	async function search(e: SubmitEvent) {
		e.preventDefault();
		if (!query.trim()) return;
		routeBusy = 'search';
		routeProblem = null;
		const params = new URLSearchParams({ q: query.trim() });
		if (here) {
			params.set('lon', String(here[0]));
			params.set('lat', String(here[1]));
		}
		const res = await fetch(`/carretera/buscar?${params}`).catch(() => null);
		const body = await res?.json().catch(() => null);
		routeBusy = null;
		if (!res?.ok) return void (routeProblem = body?.message ?? 'Sin conexión');
		places = body;
	}

	/** `again`: recalculated on the way, off the route; the list stays as it is meanwhile. */
	async function go(place: Place, again = false) {
		if (!here) return void (routeProblem = 'Esperando a saber dónde estás (el GPS)…');
		routeBusy = again ? 'reroute' : 'route';
		routeProblem = null;
		const res = await fetch('/carretera/ruta', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ from: here, to: place.at })
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		routeBusy = null;
		if (!res?.ok) return void (routeProblem = body?.message ?? 'Sin conexión');
		route = body;
		destination = place;
		places = null;
	}

	/**
	 * Guidance (phase 3c), at every position: the next maneuver and how far it is. Off the route for
	 * a while, it is asked again from where we are; not too often, for the free plan's quota.
	 */
	const along = $derived(route ? alongLine(route.line) : null);
	const guidance = $derived(route && along && here ? guide(route, along, here) : null);
	/** Further than this from the line, and for this many positions in a row (~1 a second). */
	const OFF_ROUTE_METRES = 50;
	const OFF_ROUTE_POSITIONS = 3;
	const REROUTE_EVERY_MS = 20_000;
	let offPositions = 0;
	let reroutedAt = 0;
	$effect(() => {
		const g = guidance;
		if (!g || g.arrived) return;
		offPositions = g.off > OFF_ROUTE_METRES ? offPositions + 1 : 0;
		if (offPositions < OFF_ROUTE_POSITIONS || Date.now() - reroutedAt < REROUTE_EVERY_MS) return;
		offPositions = 0;
		reroutedAt = Date.now();
		untrack(() => {
			if (destination && routeBusy === null) void go(destination, true);
		});
	});

	/**
	 * The directions aloud (phase 3d), with the device's voice, the music lower meanwhile: each
	 * maneuver well before and at it, and the arrival. Remembered in this browser if turned off.
	 */
	const SPOKEN_KEY = 'carretera-voz';
	let spoken = $state(true);
	$effect(() => {
		try {
			spoken = localStorage.getItem(SPOKEN_KEY) !== 'no';
		} catch {
			// Private windows: on.
		}
	});
	function setSpoken(value: boolean) {
		spoken = value;
		if (!value) speechSynthesis.cancel();
		try {
			if (value) localStorage.removeItem(SPOKEN_KEY);
			else localStorage.setItem(SPOKEN_KEY, 'no');
		} catch {
			// Same.
		}
	}

	/** What was said of this route: each thing once. A new route, said anew. */
	let said = new Set<string>();
	$effect(() => {
		void route;
		said = new Set();
	});

	function say(text: string) {
		if (!('speechSynthesis' in window)) return;
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'es-ES';
		music.duck(true);
		utterance.onend = utterance.onerror = () => {
			if (!speechSynthesis.speaking) music.duck(false);
		};
		speechSynthesis.speak(utterance);
	}

	$effect(() => {
		const g = guidance;
		if (!g || !spoken) return;
		const next = toSay(
			g,
			untrack(() => speed),
			said
		);
		if (!next) return;
		said.add(next.key);
		say(next.text);
	});

	/**
	 * Sharing the trip (#81): its link to send (WhatsApp…), the route's destination and arrival with
	 * each position. It stops on arriving and on leaving this page.
	 */
	function share() {
		void tripShare.start(() => ({
			destination: destination?.label ?? null,
			arrivesAt:
				route && guidance
					? Date.now() + route.duration * (guidance.remaining / (route.distance || 1)) * 1000
					: null
		}));
	}
	$effect(() => {
		if (guidance?.arrived) untrack(() => void tripShare.stop());
	});
	$effect(() => () => void tripShare.stop());
	let copied = $state(false);
	async function sendLink() {
		const url = tripShare.url;
		if (!url) return;
		const shared = { title: 'Mi viaje', text: 'Por dónde voy, mientras conduzco:', url };
		if (navigator.canShare?.(shared)) return navigator.share(shared).catch(() => {});
		await navigator.clipboard?.writeText(url).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 2500);
	}

	// The step being done, in view in the list.
	let stepList = $state<HTMLOListElement>();
	$effect(() => {
		const index = guidance?.nextIndex;
		if (index === undefined || index < 0) return;
		stepList?.children[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	function clearRoute() {
		route = null;
		destination = null;
		places = null;
		query = '';
	}

	// The map hidden with the route open: back to the stations.
	$effect(() => {
		if (!mapShown && tab === 'ruta') tab = 'radio';
	});

	const clock = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
	/** «1 h 25 min», «12 min». */
	function durationText(seconds: number) {
		const minutes = Math.round(seconds / 60);
		return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
	}

	const big =
		'flex shrink-0 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-100 active:scale-95 active:bg-zinc-700 disabled:opacity-40';
	const tile =
		'flex min-h-20 items-center gap-3 rounded-2xl border-2 p-3 text-left active:scale-[0.98]';
</script>

<svelte:head>
	<title>Carretera · JellyCartoon</title>
</svelte:head>

<div
	class={['bg-zinc-950 text-zinc-100 select-none', mapShown && 'grid h-dvh grid-cols-2 gap-4 p-4']}
>
	{#if mapShown}
		<div class="relative h-full min-h-0">
			<RoadMap
				{route}
				destination={destination?.at ?? null}
				onposition={(at, metresPerSecond) => {
					here = at;
					speed = metresPerSecond;
				}}
			/>
			<!-- The next maneuver, big, over the map: what to do, and in how much. -->
			{#if routeBusy === 'reroute'}
				<p
					class="absolute inset-x-3 top-3 rounded-2xl bg-zinc-950/90 p-4 text-2xl font-semibold text-amber-300"
				>
					Recalculando la ruta…
				</p>
			{:else if guidance?.arrived && destination}
				<p
					class="absolute inset-x-3 top-3 rounded-2xl bg-emerald-600/95 p-4 text-2xl font-semibold text-white"
				>
					Has llegado: {destination.label}
				</p>
			{:else if guidance?.next}
				<div
					class="absolute inset-x-3 top-3 flex items-center gap-4 rounded-2xl bg-zinc-950/90 p-4 shadow-xl"
				>
					<ManeuverIcon type={guidance.next.type} class="h-16 w-16 shrink-0 text-amber-400" />
					<div class="min-w-0">
						<p class="text-4xl font-bold tabular-nums">{distanceText(guidance.toNext)}</p>
						<p class="line-clamp-2 text-xl text-zinc-200">{guidance.next.instruction}</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}
	<div class={['flex flex-col gap-4', mapShown ? 'min-h-0 overflow-y-auto' : 'min-h-dvh p-4']}>
		<div class="flex items-center justify-between gap-3">
			<a href="/" class="rounded-xl px-3 py-2 text-lg text-zinc-400 active:bg-zinc-800">← Salir</a>
			{#if data.shareable && !tripShare.url}
				<button
					class="rounded-full border border-zinc-700 px-4 py-2 text-base text-zinc-300 disabled:opacity-50"
					disabled={tripShare.busy}
					onclick={share}>{tripShare.busy ? 'Compartiendo…' : 'Compartir viaje'}</button
				>
			{/if}
			{#if data.recordTrips}
				<!-- Kept, and said: where one goes is not kept without knowing it (#81). -->
				<a
					href="/viajes"
					class="rounded-full px-3 py-2 text-base text-zinc-400 active:bg-zinc-800"
					title="Se guarda este viaje (Ajustes); tus viajes, en /viajes"
					>{tripRecorder.problem ? '⚠ No se guarda el viaje' : '● Guardando el viaje'}</a
				>
			{/if}
			{#if data.map && wide}
				<button
					class="rounded-full border border-zinc-700 px-4 py-2 text-base text-zinc-300"
					aria-pressed={showMap}
					onclick={() => (showMap = !showMap)}>{showMap ? 'Ocultar mapa' : 'Mapa'}</button
				>
			{/if}
			<button
				class={[
					'rounded-full border px-4 py-2 text-base',
					musicQuality.value === 'saver'
						? 'border-emerald-500/60 text-emerald-300'
						: 'border-zinc-700 text-zinc-400'
				]}
				aria-pressed={musicQuality.value === 'saver'}
				onclick={() => musicQuality.set(musicQuality.value === 'saver' ? 'original' : 'saver')}
				>Ahorro de datos: {musicQuality.value === 'saver' ? 'sí' : 'no'}</button
			>
		</div>

		{#if tripShare.url}
			<!-- Shared: said, always in view, with its link and how to stop it (#81). -->
			<div
				class="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-3"
			>
				<span class="mr-auto text-lg text-emerald-300">● Compartiendo tu viaje</span>
				<button class="rounded-xl bg-emerald-600 px-4 py-2 text-lg text-white" onclick={sendLink}
					>{copied ? 'Enlace copiado' : 'Enviar enlace'}</button
				>
				<button
					class="rounded-xl bg-zinc-800 px-4 py-2 text-lg"
					onclick={() => void tripShare.stop()}>Dejar de compartir</button
				>
			</div>
		{:else if tripShare.problem}
			<p class="rounded-xl bg-red-950 p-3 text-red-200">{tripShare.problem}</p>
		{/if}

		{#if screenProblem}
			<p class="rounded-xl bg-amber-950 p-3 text-amber-200">{screenProblem}</p>
		{/if}

		<!-- What plays, with buttons a thumb finds without looking. -->
		<section class="rounded-3xl bg-zinc-900 p-4">
			{#if playing}
				<div class="flex items-center gap-4">
					{#if playing.image}
						<img
							src={playing.image}
							alt=""
							class="h-20 w-20 shrink-0 rounded-xl bg-zinc-800 object-cover"
						/>
					{/if}
					<div class="min-w-0">
						<p class="truncate text-2xl font-semibold">{playing.title}</p>
						<p class="truncate text-lg text-zinc-400">{playing.detail}</p>
					</div>
				</div>
				<div class="mt-4 flex items-center justify-center gap-4">
					{#if music.podcast}
						<button
							class="{big} h-20 w-20 text-xl"
							aria-label="Atrás {SKIP_BACK} segundos"
							onclick={() => music.skip(-SKIP_BACK)}>−{SKIP_BACK}</button
						>
					{:else if !music.radio}
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
					{#if music.podcast}
						<button
							class="{big} h-20 w-20 text-xl"
							aria-label="Adelante {SKIP_FORWARD} segundos"
							onclick={() => music.skip(SKIP_FORWARD)}>+{SKIP_FORWARD}</button
						>
					{:else if !music.radio}
						<button
							class="{big} h-20 w-20"
							aria-label="Siguiente"
							disabled={music.index >= music.queue.length - 1 && !music.repeat}
							onclick={() => music.next()}><MediaIcon name="next" class="h-9 w-9" /></button
						>
					{/if}
				</div>
			{:else}
				<p class="py-6 text-center text-xl text-zinc-400">No suena nada. Elige abajo, o pídelo.</p>
			{/if}
		</section>

		<!-- The microphone: what to use while driving. And beside it, a photo (#81). -->
		<section class="flex flex-col items-center gap-3">
			<div class="flex items-center gap-6">
				<button
					class={[
						'flex h-32 w-32 touch-none items-center justify-center rounded-full shadow-2xl transition duration-150',
						voice.phase === 'listening'
							? 'scale-110 bg-red-500 text-white'
							: 'bg-amber-500 text-zinc-950 active:scale-95',
						voice.phase === 'thinking' && 'opacity-60'
					]}
					aria-label={micMode.tap
						? voice.phase === 'listening'
							? 'Toca para enviar'
							: 'Toca para hablar'
						: 'Mantén pulsado para hablar'}
					disabled={voice.phase === 'thinking'}
					onpointerdown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId);
						press();
					}}
					onpointerup={release}
					onpointercancel={release}
					oncontextmenu={(e) => e.preventDefault()}
				>
					<svg viewBox="0 0 24 24" class="h-16 w-16" fill="currentColor" aria-hidden="true">
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
				<button
					class="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 text-4xl shadow-xl active:scale-95 disabled:opacity-50"
					aria-label="Hacer una foto"
					title="Una foto hacia la carretera, con dónde y cuándo (o di «haz una foto»)"
					disabled={roadPhotos.busy}
					onclick={() => void roadPhotos.take()}>{roadPhotos.busy ? '…' : '📷'}</button
				>
			</div>
			{#if roadPhotos.said}
				<p class="text-lg text-emerald-300" aria-live="polite">{roadPhotos.said}</p>
			{/if}
			<p class="min-h-7 text-center text-xl" aria-live="polite">
				{#if voice.phase === 'listening'}
					<span class="text-red-400">Te escucho…{micMode.tap ? ' toca para enviar' : ''}</span>
				{:else if voice.phase === 'thinking'}
					<span class="text-zinc-300">Un momento…</span>
				{:else if voice.problem}
					<span class="text-amber-300">{voice.problem}</span>
				{:else if voice.reply}
					{voice.reply}
				{:else}
					<span class="text-zinc-500">«Pon Radio 3», «siguiente», «el último podcast de…»</span>
				{/if}
			</p>
			{#if voice.options.length}
				<div class="flex flex-wrap justify-center gap-3">
					{#each voice.options as option (option.command)}
						<button
							class="rounded-full bg-zinc-800 px-6 py-3 text-xl active:bg-amber-500 active:text-zinc-950"
							disabled={voice.phase !== 'idle'}
							onclick={() => voice.command(option.command)}>{option.label}</button
						>
					{/each}
				</div>
			{/if}
		</section>

		{#if problem}
			<p class="rounded-xl bg-red-950 p-3 text-red-200">{problem}</p>
		{/if}

		<!-- One touch to put something on. -->
		<section class="flex min-h-0 flex-1 flex-col gap-3">
			<div class="grid auto-cols-fr grid-flow-col gap-2" role="tablist">
				{#each TABS as t (t.id)}
					<button
						role="tab"
						aria-selected={tab === t.id}
						class={[
							'rounded-xl py-3 text-xl font-semibold',
							tab === t.id ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900 text-zinc-300'
						]}
						onclick={() => (tab = t.id)}>{t.label}</button
					>
				{/each}
			</div>

			<div class="grid grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2" role="tabpanel">
				{#if tab === 'ruta'}
					<div class="flex flex-col gap-3 sm:col-span-2">
						{#if route && destination}
							<div class="rounded-2xl bg-zinc-900 p-4">
								<p class="truncate text-xl font-semibold">{destination.label}</p>
								<p class="text-lg text-zinc-300">
									{distanceText(guidance?.remaining ?? route.distance)} · {durationText(
										route.duration *
											((guidance?.remaining ?? route.distance) / (route.distance || 1))
									)} · llegada a las
									{clock.format(
										Date.now() +
											route.duration *
												((guidance?.remaining ?? route.distance) / (route.distance || 1)) *
												1000
									)}
								</p>
								<div class="mt-3 flex flex-wrap gap-2">
									<button
										class="rounded-xl bg-zinc-800 px-5 py-3 text-lg active:bg-zinc-700"
										onclick={clearRoute}>Quitar ruta</button
									>
									<button
										class={[
											'rounded-xl px-5 py-3 text-lg',
											spoken ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-400'
										]}
										aria-pressed={spoken}
										onclick={() => setSpoken(!spoken)}>{spoken ? 'Voz: sí' : 'Voz: no'}</button
									>
								</div>
							</div>
							<ol bind:this={stepList} class="flex flex-col gap-2">
								{#each route.steps as step, i (i)}
									<li
										class={[
											'flex items-baseline gap-3 rounded-xl px-4 py-3 text-lg',
											i === guidance?.nextIndex
												? 'bg-amber-500/20 ring-2 ring-amber-400'
												: i < (guidance?.nextIndex ?? 0)
													? 'bg-zinc-900 text-zinc-500'
													: 'bg-zinc-900'
										]}
										aria-current={i === guidance?.nextIndex ? 'step' : undefined}
									>
										<span class="min-w-0 flex-1">{step.instruction}</span>
										{#if step.distance}
											<span class="shrink-0 text-base text-zinc-400"
												>{distanceText(step.distance)}</span
											>
										{/if}
									</li>
								{/each}
							</ol>
						{:else}
							<form class="flex gap-2" onsubmit={search}>
								<input
									bind:value={query}
									type="search"
									enterkeyhint="search"
									placeholder="¿A dónde vas?"
									aria-label="Destino"
									class="min-w-0 flex-1 rounded-xl border-zinc-700 bg-zinc-900 px-4 py-3 text-xl"
								/>
								<button
									class="rounded-xl bg-amber-500 px-5 text-xl font-semibold text-zinc-950 disabled:opacity-50"
									disabled={routeBusy !== null}
									>{routeBusy === 'search' ? 'Buscando…' : 'Buscar'}</button
								>
							</form>
							{#if !here}
								<p class="text-lg text-zinc-400">Esperando a saber dónde estás (el GPS)…</p>
							{/if}
							{#each places ?? [] as place (place.label)}
								<button
									class="{tile} border-white/10 bg-zinc-900"
									disabled={routeBusy !== null}
									onclick={() => go(place)}
								>
									<span class="min-w-0 text-xl"
										>{routeBusy === 'route' ? 'Calculando la ruta…' : place.label}</span
									>
								</button>
							{:else}
								{#if places}
									<p class="text-lg text-zinc-400">No he encontrado ese sitio.</p>
								{/if}
							{/each}
						{/if}
						{#if routeProblem}
							<p class="rounded-xl bg-red-950 p-3 text-red-200">{routeProblem}</p>
						{/if}
					</div>
				{:else if tab === 'radio'}
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
						<p class="text-lg text-zinc-400">No hay listas. Se hacen en Música.</p>
					{/each}
				{:else}
					{#each data.inProgress as episode (episode.id)}
						{@const on = music.podcast?.id === episode.id}
						<button
							class={[
								tile,
								on ? 'border-amber-400 bg-amber-500/15' : 'border-white/10 bg-zinc-900'
							]}
							disabled={loading !== null}
							onclick={() => podcast(episode.id)}
						>
							{#if episode.imageUrl}
								<img
									src={episode.imageUrl}
									alt=""
									class="h-14 w-14 shrink-0 rounded-lg bg-zinc-800 object-cover"
								/>
							{/if}
							<span class="min-w-0">
								<span class="block truncate text-xl font-semibold">{episode.title}</span>
								<span class="block truncate text-base text-zinc-400"
									>Seguir · {episode.podcastTitle}</span
								>
							</span>
						</button>
					{/each}
					{#each data.podcasts as p (p.id)}
						{@const on = music.podcast?.id === p.latest.id}
						<button
							class={[
								tile,
								on ? 'border-amber-400 bg-amber-500/15' : 'border-white/10 bg-zinc-900'
							]}
							disabled={loading !== null}
							onclick={() => podcast(p.latest.id)}
						>
							{#if p.imageUrl}
								<img
									src={p.imageUrl}
									alt=""
									class="h-14 w-14 shrink-0 rounded-lg bg-zinc-800 object-cover"
								/>
							{/if}
							<span class="min-w-0">
								<span class="block truncate text-xl font-semibold">{p.title}</span>
								<span class="block truncate text-base text-zinc-400"
									>Lo último: {p.latest.title}</span
								>
							</span>
						</button>
					{:else}
						{#if !data.inProgress.length}
							<p class="text-lg text-zinc-400">No sigues ningún podcast. Se siguen en Radio.</p>
						{/if}
					{/each}
				{/if}
			</div>
		</section>
	</div>
</div>

<!-- The sound plays through MusicBar's <audio>; its bar is for the rest of the app. -->
<div class="hidden"><MusicBar /></div>
