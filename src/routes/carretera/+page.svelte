<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import MediaIcon from '#lib/components/MediaIcon.svelte';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import ManeuverIcon from '#lib/components/ManeuverIcon.svelte';
	import RoadMap from '#lib/components/RoadMap.svelte';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import type { MusicTrack } from '#lib/music.ts';
	import { coverUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
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
	import { durationText, estimate, Pace } from '#lib/road-eta.ts';
	import { loadRecent, matching, remember, saveRecent } from '#lib/recent-places.ts';
	import { toSay } from '#lib/road-voice.ts';
	import type { PageProps } from './$types';

	/**
	 * The road mode (#78): the tablet by the steering wheel, in half of the screen beside the
	 * navigator (Android's split screen). Only sound: what plays, big; the microphone, bigger; and
	 * one touch to put on a station, a list or a podcast. The screen stays on.
	 */

	let { data }: PageProps = $props();

	type Tab = 'radio' | 'musica' | 'listas' | 'podcasts' | 'ruta';
	/**
	 * The right-hand side (or the whole screen, without the map beside): Inicio (`null`), with what
	 * plays, the microphone and a big button for each section; or a section, its list filling it, with
	 * «← Inicio». Putting something on goes back to Inicio by itself: chosen, and eyes on the road.
	 */
	let tab = $state<Tab | null>(null);
	let loading = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let screenProblem = $state<string | null>(null);
	/** The trip's dot, touched: what it means, or what went wrong. */
	let tripNote = $state(false);
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

	/**
	 * A phone upright: no room beside, so the map has its own tab, Ruta. Told from the tablet in half
	 * of the screen, as narrow, by the device's screen: under 600 px on its short side, as Android
	 * tells phones from tablets. With the tablet in half, beside the navigator, no map nor GPS.
	 */
	let phone = $state(false);
	$effect(() => {
		const update = () => (phone = Math.min(screen.width, screen.height) < 600);
		update();
		addEventListener('resize', update);
		return () => removeEventListener('resize', update);
	});
	const mapInTab = $derived(data.map && !wide && phone);
	/** A route, beside or in its tab. */
	const routable = $derived(mapShown || mapInTab);

	// The voice knows it is in the car: no video, no house's speakers, short answers; and it can
	// ask for a route («llévame a…») or say where we are, from here.
	$effect(() => {
		voice.road = {
			position: () => here,
			navigation: () =>
				destination && route
					? `a ${destination.label}, quedan ${distanceText(guidance?.remaining ?? route.distance)}${
							eta
								? `, unos ${durationText(eta.seconds)}: llegada hacia las ${clock.format(eta.arrival)}`
								: ''
						}`
					: null,
			navigate: (place) => {
				if (!place) return clearRoute();
				if (routable) tab = 'ruta';
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
		// On: back to Inicio, as in the car's own screens. A route stays, with its steps.
		if (!problem && tab !== 'ruta') tab = null;
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
			if (!res?.ok) return 'No se pudo cargar.';
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

	/** Drawn, so they are seen at a glance; their names for whoever does not see them. */
	const TABS: { id: Tab; label: string }[] = $derived([
		{ id: 'radio', label: 'Radio' },
		...(data.music ? [{ id: 'musica' as const, label: 'Música' }] : []),
		{ id: 'listas', label: 'Listas' },
		{ id: 'podcasts', label: 'Podcasts' },
		// Only with the map beside, or a phone's own tab for it: where the route is drawn.
		...(routable ? [{ id: 'ruta' as const, label: 'Ruta' }] : [])
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

	/**
	 * Moving (the GPS's speed over ~10 km/h): the search box goes, not to type while driving; it comes
	 * back when stopped. Said by voice meanwhile.
	 */
	const moving = $derived((speed ?? 0) > 2.8);

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
		// The places to choose, beside: big, for a finger; or why there are none.
		tab = 'ruta';
		if (!res?.ok) return void (routeProblem = body?.message ?? 'Sin conexión');
		places = body;
	}

	/** Asked for before the GPS said where we are (by voice, on the phone): it goes then. */
	let waiting = $state<Place | null>(null);
	$effect(() => {
		if (!here || !waiting) return;
		const place = waiting;
		waiting = null;
		untrack(() => void go(place));
	});

	/** `again`: recalculated on the way, off the route; the list stays as it is meanwhile. */
	async function go(place: Place, again = false) {
		if (!here) {
			waiting = place;
			return void (routeProblem = 'Esperando a saber dónde estás (el GPS)…');
		}
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
		// Made again on the way (off it): one's pace so far stays for the new one.
		pace.restart(again);
		route = body;
		destination = place;
		places = null;
		if (!again) saveRecent((recent = remember(recent, place)));
	}

	/**
	 * Below the box as one types (#78): the last places gone to, from this device, then
	 * openrouteservice's suggestions (from 3 letters, once typing stops for a moment). One touched,
	 * the route at once.
	 */
	let recent = $state<Place[]>([]);
	$effect(() => {
		recent = loadRecent();
	});
	let suggesting = $state(false);
	let suggestions = $state<Place[]>([]);
	const recentShown = $derived(matching(recent, query));
	const suggestionsShown = $derived(
		suggestions.filter((s) => !recentShown.some((r) => r.label === s.label))
	);
	$effect(() => {
		const q = query.trim();
		if (!suggesting || q.length < 3) return void (suggestions = []);
		const asked = new AbortController();
		const timer = setTimeout(async () => {
			const params = new URLSearchParams({ q });
			const at = untrack(() => here);
			if (at) {
				params.set('lon', String(at[0]));
				params.set('lat', String(at[1]));
			}
			const res = await fetch(`/carretera/sugerencias?${params}`, { signal: asked.signal }).catch(
				() => null
			);
			// Without them (the quota, no signal), the last places and «Buscar» are still there.
			suggestions = res?.ok ? await res.json().catch(() => []) : [];
		}, 300);
		return () => {
			clearTimeout(timer);
			asked.abort();
		};
	});

	function choose(place: Place) {
		suggesting = false;
		query = place.label;
		// Beside: the route as it comes, or why not yet (the GPS).
		tab = 'ruta';
		void go(place);
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
			arrivesAt: eta ? eta.arrival.getTime() : null
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
		waiting = null;
		route = null;
		destination = null;
		places = null;
		query = '';
	}

	// The map hidden with the route open: back to the stations.
	$effect(() => {
		if (!routable && tab === 'ruta') tab = null;
	});

	/**
	 * On the phone, the map while it is looked at, or while a route is followed in another tab: its
	 * GPS is what guides, so the directions go on with Radio or Música in view.
	 */
	const tabMap = $derived(mapInTab && (tab === 'ruta' || route !== null));

	const clock = new Intl.DateTimeFormat('es', { timeStyle: 'short' });

	/**
	 * How long is left and when we arrive: stretch by stretch, and at one's pace once a few km are
	 * driven (`Pace`, time moving only). Again at each position.
	 */
	const pace = new Pace();
	const eta = $derived(
		route && guidance && !guidance.arrived ? estimate(route, guidance, pace) : null
	);

	/** Each position from the GPS: where we are, how fast, and the time driving for one's pace. */
	function positioned(at: LngLat, metresPerSecond: number | null) {
		pace.tick(Date.now(), metresPerSecond);
		here = at;
		speed = metresPerSecond;
	}

	const big =
		'flex shrink-0 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-100 active:scale-95 active:bg-zinc-700 disabled:opacity-40';
	const tile =
		'flex min-h-20 items-center gap-3 rounded-2xl border-2 p-3 text-left active:scale-[0.98]';
</script>

<svelte:head>
	<title>Carretera · JellyCartoon</title>
</svelte:head>

<!-- The next maneuver, big: what to do, and in how much. Over the map, or above the tabs. -->
{#snippet maneuver(where: string)}
	{#if routeBusy === 'reroute'}
		<p class="{where} rounded-2xl bg-zinc-950/90 p-4 text-2xl font-semibold text-amber-300">
			Recalculando la ruta…
		</p>
	{:else if guidance?.arrived && destination}
		<p class="{where} rounded-2xl bg-emerald-600/95 p-4 text-2xl font-semibold text-white">
			Has llegado: {destination.label}
		</p>
	{:else if guidance?.next}
		<div class="{where} flex items-center gap-4 rounded-2xl bg-zinc-950/90 p-4 text-left shadow-xl">
			<ManeuverIcon type={guidance.next.type} class="h-16 w-16 shrink-0 text-amber-400" />
			<div class="min-w-0 flex-1">
				<p class="text-4xl font-bold tabular-nums">{distanceText(guidance.toNext)}</p>
				<p class="line-clamp-2 text-xl text-zinc-200">{guidance.next.instruction}</p>
			</div>
			{#if eta}
				<!-- What is left, always in view: the time, and when. -->
				<div class="shrink-0 text-right">
					<p class="text-2xl font-semibold tabular-nums">{durationText(eta.seconds)}</p>
					<p class="text-lg text-zinc-400 tabular-nums">llega {clock.format(eta.arrival)}</p>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Where to, written on the map: only parked and without a route; the places, in the panel. -->
{#snippet searchBox()}
	{#if !route && !moving}
		<form
			class="absolute inset-x-3 top-3 flex gap-2"
			onsubmit={(e) => {
				suggesting = false;
				void search(e);
			}}
		>
			<div class="relative min-w-0 flex-1">
				<input
					bind:value={query}
					type="search"
					enterkeyhint="search"
					autocomplete="off"
					placeholder="¿A dónde vas?"
					aria-label="Destino"
					role="combobox"
					aria-autocomplete="list"
					aria-expanded={suggesting && (recentShown.length > 0 || suggestionsShown.length > 0)}
					aria-controls="destinos"
					class="w-full rounded-xl border-zinc-700 bg-zinc-950/90 px-4 py-3 text-xl shadow-xl"
					onfocus={() => (suggesting = true)}
					onblur={() => (suggesting = false)}
					onkeydown={(e) => e.key === 'Escape' && (suggesting = false)}
				/>
				{#if suggesting && (recentShown.length || suggestionsShown.length)}
					<!-- Kept open while touched: the press would blur the box first. -->
					<ul
						id="destinos"
						class="absolute inset-x-0 top-full mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-2xl"
					>
						{#each recentShown as place (place.label)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 px-4 py-3 text-left text-lg active:bg-zinc-800"
									onpointerdown={(e) => e.preventDefault()}
									onclick={() => choose(place)}
								>
									<!-- Gone to before. -->
									<svg
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
										class="h-6 w-6 shrink-0 text-zinc-400"
										aria-hidden="true"
										><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg
									>
									<span class="min-w-0 truncate">{place.label}</span>
								</button>
							</li>
						{/each}
						{#each suggestionsShown as place (place.label)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 px-4 py-3 text-left text-lg active:bg-zinc-800"
									onpointerdown={(e) => e.preventDefault()}
									onclick={() => choose(place)}
								>
									<svg
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										class="h-6 w-6 shrink-0 text-zinc-500"
										aria-hidden="true"
										><path
											d="M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 12 3.3a6.5 6.5 0 0 1 6.5 6.5C18.5 14.8 12 21 12 21z"
										/><circle cx="12" cy="9.8" r="2.3" /></svg
									>
									<span class="min-w-0 truncate">{place.label}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<button
				class="rounded-xl bg-amber-500 px-5 text-xl font-semibold text-zinc-950 shadow-xl disabled:opacity-50"
				disabled={routeBusy !== null}>{routeBusy === 'search' ? 'Buscando…' : 'Buscar'}</button
			>
		</form>
	{/if}
{/snippet}

<!-- The microphone: held, or a tap to start and another to send (Ajustes). -->
{#snippet mic(size: string, icon: string)}
	<button
		class={[
			'flex shrink-0 touch-none items-center justify-center rounded-full shadow-2xl transition duration-150',
			size,
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
		<svg viewBox="0 0 24 24" class={icon} fill="currentColor" aria-hidden="true">
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
{/snippet}

<!-- What the voice is doing, or said. -->
{#snippet voiceLine()}
	{#if voice.phase === 'listening'}
		<span class="text-red-400">Te escucho…{micMode.tap ? ' toca para enviar' : ''}</span>
	{:else if voice.phase === 'thinking'}
		<span class="text-zinc-300">Un momento…</span>
	{:else if voice.problem}
		<span class="text-amber-300">{voice.problem}</span>
	{:else if voice.reply}
		{voice.reply}
	{/if}
{/snippet}

<!-- Each tab, drawn: Radio and Música as in the rest of the app; Podcasts as headphones here, not
the app's microphone, which the voice's big one right above would be taken for. -->
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
			{#if id === 'podcasts'}
				<path d="M4 15v-3a8 8 0 0 1 16 0v3" />
				<path
					d="M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z"
				/>
			{:else if id === 'listas'}
				<path d="M4 6h11M4 11h11M4 16h7" />
				<path d="M18 19.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM18 19.5V9l3-1" />
			{:else}
				<path
					d="M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 12 3.3a6.5 6.5 0 0 1 6.5 6.5C18.5 14.8 12 21 12 21z"
				/>
				<circle cx="12" cy="9.8" r="2.3" />
			{/if}
		</svg>
	{/if}
{/snippet}

<div
	class={['bg-zinc-950 text-zinc-100 select-none', mapShown && 'grid h-dvh grid-cols-2 gap-4 p-4']}
>
	{#if mapShown}
		<div class="relative h-full min-h-0">
			<RoadMap {route} destination={destination?.at ?? null} onposition={positioned} />
			{@render maneuver('absolute inset-x-3 top-3')}
			{@render searchBox()}
			<!-- Out of the way of the next maneuver, at the top; «Mapa» brings it back. -->
			<button
				class="absolute right-3 bottom-10 rounded-full bg-zinc-950/80 px-4 py-2 text-lg text-zinc-200 shadow-lg active:bg-zinc-800"
				onclick={() => (showMap = false)}>Ocultar mapa</button
			>
		</div>
	{/if}
	<div class={['flex flex-col gap-4', mapShown ? 'min-h-0' : 'min-h-dvh p-4']}>
		{#if tab === null}
			<!-- Leaving, and whether the trip is kept: in what plays' own first line. -->
		{:else}
			<!-- In a section: the way back, big; what plays, to pause it; and the microphone, small. -->
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
				{@render mic('h-16 w-16', 'h-9 w-9')}
			</div>
			{#if voice.phase !== 'idle' || voice.problem || voice.reply}
				<p class="text-center text-lg" aria-live="polite">{@render voiceLine()}</p>
			{/if}
		{/if}

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

		{#if tab === null}
			<div class={['flex flex-col gap-4', mapShown && 'min-h-0 flex-1 overflow-y-auto']}>
				<!-- What plays, with buttons a thumb finds without looking; leaving, and the trip's dot, in
				its first line. -->
				<section class="rounded-3xl bg-zinc-900 p-4">
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
						{:else}
							<p class="min-w-0 flex-1 py-4 text-center text-xl text-zinc-400">
								No suena nada. Elige abajo, o pídelo.
							</p>
						{/if}
						{#if data.map && wide && !showMap}
							<button
								class="shrink-0 rounded-full bg-zinc-800 px-4 py-2 text-base text-zinc-300 active:bg-zinc-700"
								onclick={() => (showMap = true)}>Mapa</button
							>
						{/if}
						<!-- Kept or not, and said: where one goes is not kept without knowing it (#81). -->
						<button
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-800 active:bg-zinc-700"
							aria-label={!data.recordTrips
								? 'No se guardan tus viajes'
								: tripRecorder.problem
									? 'No se guarda el viaje'
									: 'Se guarda este viaje'}
							aria-expanded={tripNote}
							onclick={() => (tripNote = !tripNote)}
						>
							{#if !data.recordTrips}
								<span class="h-4 w-4 rounded-full bg-zinc-500"></span>
							{:else if tripRecorder.problem}
								<span
									class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-zinc-950"
									>!</span
								>
							{:else}
								<span class="h-4 w-4 animate-pulse rounded-full bg-red-500"></span>
							{/if}
						</button>
					</div>
					{#if tripNote}
						<p class="mt-2 text-right text-base text-zinc-400">
							{!data.recordTrips
								? 'No se guardan tus viajes: «Guardar mis viajes», en Ajustes.'
								: tripRecorder.problem
									? `No se guarda el viaje: ${tripRecorder.problem}`
									: 'Se guarda este viaje («Guardar mis viajes», en Ajustes).'}
						</p>
					{/if}
					{#if playing}
						<div class="mt-4 flex items-center justify-center gap-4">
							{#if music.podcast}
								<button
									class="{big} h-20 w-20 text-xl"
									aria-label="Atrás {SKIP_BACK} segundos"
									onclick={() => music.skip(-SKIP_BACK)}>−{SKIP_BACK}</button
								>
							{:else if !music.radio}
								<button
									class="{big} h-20 w-20"
									aria-label="Anterior"
									onclick={() => music.previous()}
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
					{/if}
				</section>

				<!-- The microphone: what to use while driving. And beside it, a photo (#81). -->
				<section class="flex flex-col items-center gap-3">
					<div class="flex items-center gap-6">
						{@render mic('h-32 w-32', 'h-16 w-16')}
						<button
							class="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 text-4xl shadow-xl active:scale-95 disabled:opacity-50"
							aria-label="Hacer una foto"
							title="Una foto hacia la carretera, con dónde y cuándo (o di «haz una foto»)"
							disabled={roadPhotos.busy}
							onclick={() => void roadPhotos.take()}>{roadPhotos.busy ? '…' : '📷'}</button
						>
					</div>
					{#if roadPhotos.problem}
						<p class="text-lg text-amber-300" aria-live="polite">{roadPhotos.problem}</p>
					{/if}
					{#if voice.phase !== 'idle' || voice.problem || voice.reply}
						<p class="text-center text-xl" aria-live="polite">{@render voiceLine()}</p>
					{/if}
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

				{#if mapInTab && route}
					<!-- The route goes on out of its section: its next step, and back to the map. -->
					<button class="contents" aria-label="Ver la ruta" onclick={() => (tab = 'ruta')}>
						{@render maneuver('w-full')}
					</button>
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
			</div>
		{/if}

		{#if tabMap}
			<!-- Kept while a route is followed, out of sight elsewhere: its GPS guides. -->
			<div class={tab === 'ruta' ? 'relative h-[45dvh] shrink-0' : 'h-0 overflow-hidden'}>
				<RoadMap {route} destination={destination?.at ?? null} onposition={positioned} />
				{@render maneuver('absolute inset-x-3 top-3')}
				{@render searchBox()}
			</div>
		{/if}

		{#if tab !== null}
			{#if problem}
				<p class="rounded-xl bg-red-950 p-3 text-red-200">{problem}</p>
			{/if}
			<!-- The section's list, filling the rest, and scrolled on its own beside the map. -->
			<div
				class={[
					'grid grid-cols-1 content-start gap-3 sm:grid-cols-2',
					mapShown && 'min-h-0 flex-1 overflow-y-auto'
				]}
				role="region"
				aria-label={TABS.find((t) => t.id === tab)?.label}
			>
				{#if tab === 'ruta'}
					<div class="flex flex-col gap-3 sm:col-span-2">
						{#if data.shareable && !tripShare.url}
							<!-- Who waits for you, with a link: where you are, live, until you arrive (#81). -->
							<button
								class="rounded-xl bg-zinc-900 px-5 py-3 text-left text-lg text-zinc-200 active:bg-zinc-800 disabled:opacity-50"
								disabled={tripShare.busy}
								onclick={share}>{tripShare.busy ? 'Compartiendo…' : 'Compartir viaje'}</button
							>
						{/if}
						{#if route && destination}
							<div class="rounded-2xl bg-zinc-900 p-4">
								<p class="truncate text-xl font-semibold">{destination.label}</p>
								<p class="text-lg text-zinc-300">
									{distanceText(guidance?.remaining ?? route.distance)}{#if eta}
										· {durationText(eta.seconds)} · llegada a las {clock.format(eta.arrival)}{/if}
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
							{#if !places && routeBusy !== 'search'}
								<!-- Written on the map, parked; driving, said. -->
								<p class="text-lg text-zinc-400">
									Di «llévame a…»{#if routable}, o escribe el destino en el mapa{/if}.
								</p>
							{/if}
							{#if routeBusy === 'search'}
								<p class="text-lg text-zinc-300">Buscando…</p>
							{/if}
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
								>{shuffling
									? music.playing
										? '● Sonando'
										: 'En pausa'
									: 'De toda tu música'}</span
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
		{/if}
	</div>
</div>

{#if roadPhotos.last}
	<!-- The photo just taken, for a moment: whether it came out well, and whether it was kept. -->
	<figure
		class="fixed right-4 bottom-4 z-40 w-72 overflow-hidden rounded-2xl border-2 border-white/20 bg-zinc-900 shadow-2xl"
		aria-live="polite"
	>
		<img
			src={roadPhotos.last.url}
			alt="La foto que acabas de hacer"
			class="aspect-video w-full object-cover"
		/>
		<figcaption
			class={[
				'px-3 py-2 text-lg font-semibold',
				roadPhotos.last.state === 'saved'
					? 'bg-emerald-600 text-white'
					: roadPhotos.last.state === 'waiting'
						? 'bg-amber-600 text-white'
						: 'text-zinc-300'
			]}
		>
			{roadPhotos.last.state === 'saved'
				? '✓ Foto guardada'
				: roadPhotos.last.state === 'waiting'
					? 'Sin cobertura: se guardará al volver'
					: 'Guardando…'}
		</figcaption>
	</figure>
{/if}

<!-- The sound plays through MusicBar's <audio>; its bar is for the rest of the app. -->
<div class="hidden"><MusicBar /></div>
