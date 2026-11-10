<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import ManeuverIcon from 'comun/components/ManeuverIcon.svelte';
	import RoadMap from 'comun/components/RoadMap.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { coverUrl, type DjOptions, type MusicTrack } from 'comun/music.ts';
	import { dj } from 'comun/dj.svelte.ts';
	import { useKept, usePass } from '#lib/music-pass.svelte.ts';
	import { offlineMusic } from '#lib/offline-music.svelte.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { STATIONS, type RadioStation } from 'comun/radio.ts';
	import { playEpisode } from 'comun/podcast-player.svelte.ts';
	import { SKIP_BACK, SKIP_FORWARD } from 'comun/podcasts.ts';
	import { keepScreenOn } from 'comun/screen-on.ts';
	import { roadPhotos } from '#lib/road-photos.svelte.ts';
	import { tripRecorder } from '#lib/trip-recorder.svelte.ts';
	import { tripShare } from '#lib/trip-share.svelte.ts';
	import { distanceText, isLngLat, type LngLat, type Place, type Route } from 'comun/road.ts';
	import { alongLine, guide, lineAhead, locate, metresBetween } from 'comun/road-guide.ts';
	import {
		findByName,
		insertStop,
		MAX_STOPS,
		STOP_REACHED_METRES,
		stopsAhead,
		type SavedRoute,
		type WayStop
	} from 'comun/saved-places.ts';
	import { durationText, estimate, Pace } from 'comun/road-eta.ts';
	import { loadRecent, matching, remember, saveRecent } from 'comun/recent-places.ts';
	import { toSay } from 'comun/road-voice.ts';
	import { isDaytime } from 'comun/sun.ts';
	import {
		newTrip,
		parseTrip,
		REST_AFTER_SECONDS,
		restDue,
		tick,
		type TripState
	} from 'comun/road-trip.ts';
	import FuelSheet from 'comun/components/FuelSheet.svelte';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import CallPanel from '#lib/components/CallPanel.svelte';
	// `phone` is this device's size, below: the call's, `tel`.
	import { phone as tel } from '#lib/phone.svelte.ts';
	import type { IncomingCall } from '#lib/calls.ts';
	import { WAKE_WORDS, isWakeWord } from 'comun/wake-words.ts';
	import { telegramSaid, type TelegramMessage } from 'comun/telegram.ts';
	import type { PageProps } from './$types';

	/**
	 * The road mode (#253), as jellycartoon's (#78): the tablet by the steering wheel, in half of the
	 * screen beside the navigator (Android's split screen), or whole with the map and the route. What
	 * plays, big; one touch to put on a station, an album or a list. The house's songs and covers,
	 * straight from it by the pass; the map, the routes and their spoken directions, the trip kept
	 * and its photos (Viajes), from here; Modo DJ, the house's. Not yet as at home: the voice's timers
	 * and wake word. The voice: held down, heard by the house's Whisper and done by the family's AI.
	 */

	let { data }: PageProps = $props();

	type Tab =
		'radio' | 'musica' | 'listas' | 'podcasts' | 'ruta' | 'mas' | 'llamar' | 'dj' | 'telegram';
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

	/** The house's songs and covers, by the pass (music-pass.svelte.ts). */
	$effect(() => {
		if (data.pass) usePass(data.pass);
		else useKept();
	});

	/**
	 * The lists this device carries (#350): from its disk, as last updated. Without the house, the
	 * only ones, and only the songs it has.
	 */
	const playlists = $derived(
		data.pass
			? data.playlists
			: offlineMusic.lists.map((l) => ({ id: l.id, name: l.name, total: l.tracks.length }))
	);

	/**
	 * The map (phase 3a), on the left with the screen wide enough: the tablet whole, sideways. In
	 * half of it (Android's split screen, the navigator beside) it is not even made, nor the GPS asked.
	 */
	let wide = $state(false);
	$effect(() => {
		const query = matchMedia('(min-width: 768px)');
		const update = () => (wide = query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});
	const mapShown = $derived(data.map && wide);

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
						}${via.length ? `; paradas antes, en orden: ${via.map(stopText).join('; ')}` : ''}`
					: null,
			navigate: (place) => {
				if (!place) return clearRoute();
				if (routable) tab = 'ruta';
				void go(place);
			},
			trip: () =>
				trip.last && trip.metres > 0
					? `llevas ${kmText(trip.metres)} y ${durationText(trip.moving)} conduciendo; ${
							trip.sinceBreak > 0
								? `${durationText(trip.sinceBreak)} sin descansar`
								: 'acabas de descansar'
						}`
					: null,
			ahead: () =>
				route && along && guidance && here
					? lineAhead(route.line, along, here, along.at(-1)! - guidance.remaining)
					: null,
			addStop: (place, reason) => {
				if (routable) tab = 'ruta';
				addStop(place, reason);
			},
			removeStop,
			follow: (id) => {
				const saved = data.routes.find((r) => r.id === id);
				if (!saved) return;
				if (routable) tab = 'ruta';
				void follow(saved);
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
	/** How far into the song, to see at a glance; a station has none. */
	const progress = $derived.by(() => {
		if (music.radio || !playing) return null;
		const duration = music.durationSec ?? music.podcast?.durationSec ?? music.current?.durationSec;
		return duration ? { at: Math.min(music.positionSec, duration), duration } : null;
	});

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
			if (!res?.ok) return 'No se pudo cargar: ¿está la casa encendida?';
			const tracks: MusicTrack[] = await res.json();
			if (!tracks.length) return empty;
			music.play(tracks, 0);
			playingFrom = id;
		});
	}

	function list(id: number) {
		const kept = offlineMusic.lists.find((l) => l.id === id);
		if (!kept) return playFrom(`lista-${id}`, `/carretera/listas/${id}`, 'La lista está vacía.');
		if (playingHere(`lista-${id}`)) return music.toggle();
		// Carried here: as it is on the disk, no need of coverage. Without the house, what it has.
		const tracks = data.pass ? kept.tracks : kept.tracks.filter((t) => offlineMusic.has(t.id));
		if (!tracks.length) return void (problem = 'Todavía no hay canciones suyas en la tablet.');
		music.play(tracks, 0);
		playingFrom = `lista-${id}`;
		problem = null;
		if (tab !== 'ruta') tab = null;
	}

	const album = (id: number) =>
		playFrom(`album-${id}`, `/carretera/album/${id}`, 'El álbum está vacío.');

	const everything = () => playFrom('aleatorio', '/carretera/aleatorio', 'No hay música.');

	/**
	 * Modo DJ (#117), only to choose: the setups saved in Música, and first the last one started on
	 * this device, saved or not. Here, on this device: the house's speakers are far away.
	 */
	// Not a $derived: it is in this browser's storage, read once it is in the browser.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let lastDj = $state<DjOptions | null>(null);
	$effect(() => {
		lastDj = dj.remembered();
	});

	function startDj(id: string, options: DjOptions) {
		if (playingHere(id) && music.dj) return music.toggle();
		return busy(id, async () => {
			try {
				await dj.play(options);
			} catch (err) {
				return err instanceof Error ? err.message : 'No se pudo poner el Modo DJ.';
			}
			playingFrom = id;
			lastDj = options;
		});
	}

	/** «Toda la música», «Queen y Supertramp», «Queen, Supertramp y 3 más». */
	function djArtists(artists: string[]) {
		if (!artists.length) return 'Toda la música';
		if (artists.length <= 2) return artists.join(' y ');
		return `${artists.slice(0, 2).join(', ')} y ${artists.length - 2} más`;
	}

	function podcast(episodeId: number) {
		if (music.podcast?.id === episodeId) return music.toggle();
		return busy(`podcast-${episodeId}`, () => playEpisode(episodeId));
	}

	// ——— Telegram (#243): the messages that come, read aloud; the account is the house's (#253) ———

	const TELEGRAM_KEY = 'jellycartoon:carretera-telegram';
	/** «Leer en voz alta los mensajes que lleguen», on this phone: off unless asked. */
	let telegramOn = $state(false);
	/** The last ones that came while on, the newest first. */
	let telegramMessages = $state<TelegramMessage[]>([]);
	$effect(() => {
		try {
			telegramOn = localStorage.getItem(TELEGRAM_KEY) === 'on';
		} catch {
			// Private windows: off.
		}
	});
	function setTelegram(on: boolean) {
		telegramOn = on;
		try {
			if (on) localStorage.setItem(TELEGRAM_KEY, 'on');
			else localStorage.removeItem(TELEGRAM_KEY);
		} catch {
			// Same.
		}
	}
	// While on, whatever the tab: each one said as it comes, over the music lowered.
	$effect(() => {
		if (!data.telegram || !telegramOn) return;
		const events = new EventSource('/api/telegram');
		events.onmessage = (e) => {
			const message = JSON.parse(e.data) as TelegramMessage;
			telegramMessages = [message, ...telegramMessages].slice(0, 20);
			say(telegramSaid(message));
			void fetch('/api/telegram/leido', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: message.key })
			}).catch(() => {});
		};
		return () => events.close();
	});

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

	const LABELS: Record<Tab, string> = {
		radio: 'Radio',
		musica: 'Música',
		listas: 'Listas',
		podcasts: 'Podcasts',
		ruta: 'Ruta',
		mas: 'Más',
		llamar: 'Llamar',
		dj: 'DJ',
		telegram: 'Telegram'
	};
	/**
	 * Each section, its own colour: told at a glance from the seat, without reading. Shades the day
	 * look (.sol, below) leaves as they are, with white letters on them; «Más», grey.
	 */
	const COLOURS: Record<Tab, string> = {
		radio: 'bg-red-600 text-white',
		musica: 'bg-green-600 text-white',
		listas: 'bg-pink-600 text-white',
		podcasts: 'bg-violet-600 text-white',
		ruta: 'bg-blue-600 text-white',
		mas: 'bg-zinc-800 text-zinc-100',
		llamar: 'bg-green-700 text-white',
		dj: 'bg-orange-600 text-white',
		telegram: 'bg-sky-600 text-white'
	};
	/**
	 * Inicio's tiles: always these six, always in the same place, so the hand learns them. One with
	 * nothing to show stays dimmed in its place, with why, and the others do not move. DJ and Telegram,
	 * less used while driving, inside «Más».
	 */
	const HOME: { id: Tab; off: string | null }[] = $derived([
		{ id: 'radio', off: null },
		// The house's music, by its pass: without the house, only the radio.
		{ id: 'musica', off: data.pass ? null : 'Sin la casa' },
		// Without the house, those this device carries (#350).
		{ id: 'listas', off: playlists.length || data.pass ? null : 'Aún no hay' },
		// The family's, here (#253).
		{ id: 'podcasts', off: null },
		// Only with the map beside, or a phone's own tab for it: where the route is drawn.
		{ id: 'ruta', off: routable ? null : 'Sin mapa' },
		{ id: 'mas', off: null }
	]);
	/** «←»: back to «Más» from what is inside it; to Inicio from the rest. */
	const backTo = (t: Tab): Tab | null =>
		t === 'dj' || t === 'telegram' || t === 'llamar' ? 'mas' : null;
	/** What plays, as a section: its colour and drawing on the bar when it has no cover. */
	const playingTab: Tab = $derived(music.radio ? 'radio' : music.podcast ? 'podcasts' : 'musica');

	/**
	 * Calls (#330): one ringing for this person shows here, big, with its ring, besides the notice;
	 * and while one rings or lasts, what plays pauses, and goes on after.
	 */
	$effect(() => {
		const events = new EventSource('/api/llamadas/entrantes');
		events.onmessage = (e) => {
			const ringing: IncomingCall[] = JSON.parse(e.data);
			tel.stopRingingIfGone(ringing.map((c) => c.id));
			const first = ringing[0];
			if (first && !tel.busy) tel.incoming(first.id, first.fromName);
		};
		return () => events.close();
	});
	let pausedForCall = false;
	$effect(() => {
		if (tel.busy && music.playing) {
			pausedForCall = true;
			untrack(() => music.pause());
		} else if (!tel.busy && pausedForCall) {
			pausedForCall = false;
			untrack(() => music.resume());
		}
	});

	/**
	 * The route (phase 3b): the destination searched by its name, and the way there by car with its
	 * steps, from openrouteservice through the server (/carretera/buscar, /carretera/ruta).
	 */
	let here = $state<LngLat | null>(null);
	/** The fuel sheet open (#194). */
	let fueling = $state(false);
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

	async function search(e?: SubmitEvent) {
		e?.preventDefault();
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

	/**
	 * A kept route being followed (#151): its name, and the stops on the way still ahead, gone
	 * through before its end; each one left behind once passed, and not asked for again.
	 */
	let following = $state<string | null>(null);
	let via = $state<WayStop[]>([]);
	let waitingRoute = $state<SavedRoute | null>(null);

	/**
	 * `how`: a new route (`stops`, a kept route's, before `place`); `again`, recalculated on the way,
	 * off the route, through the stops still ahead, the list as it is meanwhile; `stops`, the same
	 * trip with other stops (#312), said by voice. Whether it went.
	 */
	async function go(
		place: Place,
		how: 'new' | 'again' | 'stops' = 'new',
		stops: WayStop[] = how === 'again' ? via : []
	) {
		if (!here) {
			waiting = place;
			routeProblem = 'Esperando a saber dónde estás (el GPS)…';
			return false;
		}
		routeBusy = how === 'again' ? 'reroute' : 'route';
		routeProblem = null;
		const res = await fetch('/carretera/ruta', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ from: here, to: place.at, via: stops.map((s) => s.at) })
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		routeBusy = null;
		if (!res?.ok) {
			routeProblem = body?.message ?? 'Sin conexión';
			return false;
		}
		// The same trip (off it, another stop): one's pace so far stays for the new one.
		pace.restart(how !== 'new');
		route = body;
		destination = place;
		via = stops;
		places = null;
		if (how === 'new') {
			following = null;
			if (!stops.length) saveRecent((recent = remember(recent, place)));
		}
		return true;
	}

	/** A kept route (#151): from where we are, through its stops ahead, to its end. */
	async function follow(saved: SavedRoute) {
		if (!here) {
			waitingRoute = saved;
			return void (routeProblem = 'Esperando a saber dónde estás (el GPS)…');
		}
		const ahead = stopsAhead(saved, here);
		const end = ahead.at(-1)!;
		const went = await go({ label: end.name, at: end.at }, 'new', ahead.slice(0, -1));
		if (went) following = saved.name;
	}
	$effect(() => {
		if (!here || !waitingRoute) return;
		const saved = waitingRoute;
		waitingRoute = null;
		untrack(() => void follow(saved));
	});

	/** A stop this far ahead, along the route, is said before reaching it. */
	const STOP_SOON_METRES = 1000;
	/** The stops said to be 1 km ahead (by their point): once each, also if the route is made again. */
	let soonSaid = new Set<string>();

	// A stop on the way: said at 1 km and on reaching it, when the route goes on; a new one is asked
	// without it.
	$effect(() => {
		const at = here;
		const next = via[0];
		if (!at || !next) return;
		const reached = metresBetween(at, next.at) < STOP_REACHED_METRES;
		const metres = untrack(() => stopAhead(next));
		const key = next.at.join(',');
		if (!reached && (metres > STOP_SOON_METRES || soonSaid.has(key))) return;
		untrack(() => {
			const why = next.reason ? `, para ${next.reason}` : '';
			if (reached) {
				via = via.slice(1);
				if (spoken) say(`Llegas a ${shortName(next.name)}, tu parada${why}`);
			} else {
				soonSaid.add(key);
				if (spoken) say(`A 1 kilómetro, tu parada en ${shortName(next.name)}${why}`);
			}
		});
	});

	/** «Totana, Murcia, España» said as «Totana». */
	const shortName = (label: string) => label.split(',')[0]!.trim();

	/** Metres to a stop ahead, along the route; as the crow flies without one yet. */
	function stopAhead(stop: WayStop) {
		if (route && along && guidance)
			return locate(route.line, along, stop.at).along - (along.at(-1)! - guidance.remaining);
		return here ? metresBetween(here, stop.at) : Infinity;
	}

	/** A stop ahead for the voice: its name, why, and how far along the route. */
	function stopText(stop: WayStop) {
		const ahead = stopAhead(stop);
		return `${stop.name}${stop.reason ? ` (para ${stop.reason})` : ''}${
			Number.isFinite(ahead) && ahead > 0 ? `, a ${distanceText(ahead)}` : ''
		}`;
	}

	/**
	 * A stop said by voice (#312): among those ahead where it lengthens the way least, and the route
	 * again through them to the same end. Without a route, it is where to go.
	 */
	function addStop(place: Place, reason: string | null) {
		if (!destination || !here) return void go(place);
		if (via.length >= MAX_STOPS) return void (routeProblem = `Como mucho, ${MAX_STOPS} paradas`);
		const stop = { name: place.label, at: place.at, reason };
		void withStops(insertStop(via, stop, here, destination.at));
	}

	/**
	 * The same end through other stops, and what it changes said aloud: «6 minutos más; llegas a
	 * Alicante hacia las 13:40». Driving only, not counting the time stopped.
	 */
	async function withStops(stops: WayStop[]) {
		const end = destination!;
		const before = eta?.arrival.getTime() ?? null;
		if (!(await go(end, 'stops', stops)) || before === null || !eta) return;
		const minutes = Math.round((eta.arrival.getTime() - before) / 60_000);
		const change =
			minutes === 0
				? 'Casi sin desvío'
				: `${Math.abs(minutes)} ${Math.abs(minutes) === 1 ? 'minuto' : 'minutos'} ${minutes > 0 ? 'más' : 'menos'}`;
		say(`${change}; llegas a ${shortName(end.label)} hacia las ${clock.format(eta.arrival)}`);
	}

	/** One out by its name as said (or the only one there is), or all of them with null. */
	function removeStop(name: string | null) {
		if (!destination || !via.length) return;
		const gone =
			name === null ? null : (findByName(via, name) ?? (via.length === 1 ? via[0] : null));
		if (name !== null && !gone) return;
		void withStops(via.filter((s) => gone !== null && s !== gone));
	}

	/**
	 * Below the box as one types (#78): the last places gone to, from this device, then
	 * openrouteservice's suggestions (from 3 letters, once typing stops for a moment). One touched,
	 * the route at once.
	 */
	// Not a $derived: they are in this browser's storage, read once it is in the browser.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let recent = $state<Place[]>([]);
	$effect(() => {
		recent = loadRecent();
	});
	let suggesting = $state(false);
	let suggestions = $state<Place[]>([]);
	/** Kept in Viajes (#151), with their name: first of all. */
	const savedShown = $derived(
		matching(
			data.places.map((p) => ({ label: p.name, at: p.at })),
			query,
			8
		)
	);
	const recentShown = $derived(
		matching(recent, query).filter((r) => !savedShown.some((s) => s.label === r.label))
	);
	const suggestionsShown = $derived(
		suggestions.filter((s) => ![...savedShown, ...recentShown].some((r) => r.label === s.label))
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
	 * Shared from a map («Compartir → JellyCartoon» in Google Maps, through /compartido): its route at
	 * once, or, not found, its name in the box to search. Once: the address is left clean, so that
	 * reloading does not ask for it again.
	 */
	$effect(() => {
		const params = untrack(() => page.url.searchParams);
		const at = params.get('destino')?.split(',').map(Number);
		const name = params.get('nombre') || 'Sitio compartido';
		const asked = params.get('buscar');
		if (!params.has('destino') && !asked) return;
		untrack(() => {
			replaceState('/carretera', {});
			if (isLngLat(at)) choose({ label: name, at });
			else if (asked) {
				query = asked;
				void search();
			}
		});
	});

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
			if (destination && routeBusy === null) void go(destination, 'again');
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

	// The step being done, in view in the list: only when it changes, not at each position, or the
	// list could not be scrolled by hand (up to «Quitar ruta», for one). Only beside the map, where
	// the list scrolls on its own; on a phone it would take the whole page, and the map out of sight.
	let stepList = $state<HTMLOListElement>();
	const stepIndex = $derived(guidance?.nextIndex);
	$effect(() => {
		const index = stepIndex;
		if (!mapShown || index === undefined || index < 0) return;
		stepList?.children[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	function clearRoute() {
		waiting = null;
		waitingRoute = null;
		following = null;
		via = [];
		soonSaid = new Set();
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

	/**
	 * The light: by day, white with black letters, as read in the sun (the «sol» class below, the
	 * map light too); at night, dark not to dazzle. `auto` by the sun where we are: from sunrise to
	 * sunset; `dia` or `noche` by hand (a tunnel). Remembered in this browser.
	 */
	type Light = 'auto' | 'dia' | 'noche';
	const LIGHT_KEY = 'carretera-luz';
	const LIGHTS: Light[] = ['auto', 'dia', 'noche'];
	/** Where we were last (to 0.1°, ~10 km: the sun's times barely change), for before the GPS. */
	const PLACE_KEY = 'carretera-donde';
	/** Never there yet, nor a GPS: the middle of Spain, ±40 min from anywhere in the peninsula. */
	const SPAIN: LngLat = [-3.7, 40.4];
	let lightMode = $state<Light>('auto');
	let lastPlace = $state<LngLat | null>(null);
	let now = $state(Date.now());
	$effect(() => {
		try {
			const saved = localStorage.getItem(LIGHT_KEY);
			if (LIGHTS.includes(saved as Light)) lightMode = saved as Light;
			const place = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
			if (isLngLat(place)) lastPlace = place;
		} catch {
			// Private windows: auto, in the middle of Spain.
		}
		// Without the map on, no GPS: one rough position, an hour old is fine.
		if (!here && 'geolocation' in navigator)
			navigator.geolocation.getCurrentPosition(
				(p) => (lastPlace ??= [p.coords.longitude, p.coords.latitude]),
				() => {},
				{ maximumAge: 3_600_000, timeout: 30_000 }
			);
		const clock = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(clock);
	});
	$effect(() => {
		if (!here) return;
		const rounded: LngLat = [Math.round(here[0] * 10) / 10, Math.round(here[1] * 10) / 10];
		if (rounded[0] === lastPlace?.[0] && rounded[1] === lastPlace[1]) return;
		lastPlace = rounded;
		try {
			localStorage.setItem(PLACE_KEY, JSON.stringify(rounded));
		} catch {
			// Same.
		}
	});
	const day = $derived(
		lightMode === 'dia' ||
			(lightMode === 'auto' && isDaytime(here ?? lastPlace ?? SPAIN, new Date(now)))
	);
	function nextLight() {
		lightMode = LIGHTS[(LIGHTS.indexOf(lightMode) + 1) % LIGHTS.length]!;
		try {
			if (lightMode === 'auto') localStorage.removeItem(LIGHT_KEY);
			else localStorage.setItem(LIGHT_KEY, lightMode);
		} catch {
			// Same.
		}
	}

	/**
	 * The music's own volume in the car, under the voice's: the tablet (or the car) goes loud for
	 * the voice, the music lower; kept in this browser. Leaving the road mode, the usual one.
	 */
	const CAR_VOLUME_KEY = 'carretera-musica';
	const CAR_VOLUME_STEP = 0.1;
	let carVolume = $state(0.6);
	$effect(() => {
		try {
			const saved = Number(localStorage.getItem(CAR_VOLUME_KEY));
			if (localStorage.getItem(CAR_VOLUME_KEY) !== null && saved >= 0 && saved <= 1)
				carVolume = saved;
		} catch {
			// Private windows: 60 %.
		}
		return () => music.setCarVolume(null);
	});
	$effect(() => music.setCarVolume(carVolume));
	function changeCarVolume(by: number) {
		carVolume = Math.round(Math.min(1, Math.max(0, carVolume + by)) * 10) / 10;
		try {
			localStorage.setItem(CAR_VOLUME_KEY, String(carVolume));
		} catch {
			// Same.
		}
	}

	/**
	 * The trip so far (comun/road-trip.ts), for the strip on the map: km, time driving, the rest.
	 * Kept in this browser, every few seconds: a reload on the way goes on with it.
	 */
	const TRIP_KEY = 'carretera-viaje';
	const TRIP_SAVE_MS = 10_000;
	let trip = $state<TripState>(newTrip());
	let tripSavedAt = 0;
	$effect(() => {
		try {
			trip = parseTrip(JSON.parse(localStorage.getItem(TRIP_KEY) ?? 'null'));
		} catch {
			// Private windows: from now.
		}
	});
	function saveTrip(now: number) {
		if (now - tripSavedAt < TRIP_SAVE_MS) return;
		tripSavedAt = now;
		try {
			localStorage.setItem(TRIP_KEY, JSON.stringify(trip));
		} catch {
			// Same.
		}
	}
	// Two hours driving without a rest: said once, and in the strip until one stops.
	$effect(() => {
		if (!restDue(trip)) return;
		untrack(() => {
			trip = { ...trip, restSaid: true };
			if (spoken) say('Llevas dos horas conduciendo. Para a descansar un rato.');
		});
	});
	/** «142 km», «8,4 km», «350 m». */
	const kmText = (metres: number) =>
		metres >= 10_000 ? `${Math.round(metres / 1000)} km` : distanceText(metres);

	/** The next stop on the way: how far along the route, and about how long, at the pace left. */
	const nextStop = $derived.by(() => {
		const stop = via[0];
		if (!stop || !route || !guidance) return null;
		const metres = stopAhead(stop);
		if (!Number.isFinite(metres) || metres < 0) return null;
		const seconds =
			eta && guidance.remaining > 0 ? eta.seconds * Math.min(1, metres / guidance.remaining) : null;
		return { name: shortName(stop.name), metres, seconds };
	});

	// «Alexa» instead of the button, turned on here on this tablet: only while Carretera is open.
	$effect(() => {
		// During a call (#330), with the echo cancelled, so that the other's voice does not wake it: to
		// answer it while it rings, and to hang up («cuelga»).
		wakeWord.want(wakeWord.on.carretera, tel.busy);
		return () => wakeWord.want(false);
	});

	/** Each position from the GPS: where we are, how fast, and the time driving for one's pace. */
	function positioned(at: LngLat, metresPerSecond: number | null) {
		const now = Date.now();
		pace.tick(now, metresPerSecond);
		here = at;
		speed = metresPerSecond;
		trip = tick(trip, at, metresPerSecond, now);
		saveTrip(now);
	}

	/**
	 * Leaving by mistake while driving (a thumb on «←», Android's back gesture) stops the trip and
	 * the screen: asked first, and «Seguir» by itself after a few seconds. Back from a section goes
	 * to Inicio, as its «← Inicio». Moving inside the road mode, or a `goto` (a voice command), is
	 * not asked. https://svelte.dev/docs/kit/$app-navigation#beforeNavigate
	 */
	const EXIT_ASK_MS = 3000;
	let exitDialog = $state<HTMLDialogElement>();
	let exitOpen = $state(false);
	/** Where leaving was going: `back` for the browser's back. */
	let exitTo: string | null = null;
	let exitTimer: ReturnType<typeof setTimeout> | undefined;
	/** «Salir» touched: the navigation it starts is not asked again. */
	let exitConfirmed = false;

	beforeNavigate((nav) => {
		if (exitConfirmed || nav.willUnload || !nav.to) return;
		if (nav.type !== 'link' && nav.type !== 'popstate') return;
		const path = nav.to.url.pathname;
		if (path === '/carretera' || path.startsWith('/carretera/')) return;
		nav.cancel();
		if (nav.type === 'popstate' && tab !== null) {
			tab = null;
			return;
		}
		exitTo = nav.type === 'popstate' ? 'back' : nav.to.url.href;
		exitOpen = true;
		exitDialog?.showModal();
		clearTimeout(exitTimer);
		exitTimer = setTimeout(() => exitDialog?.close(), EXIT_ASK_MS);
	});

	function exit() {
		exitConfirmed = true;
		exitDialog?.close();
		if (exitTo === 'back') history.back();
		else if (exitTo) void goto(exitTo);
	}

	const big =
		'flex shrink-0 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-100 active:scale-95 active:bg-zinc-700 disabled:opacity-40';
	const tile =
		'flex min-h-20 items-center gap-3 rounded-2xl border-2 p-3 text-left active:scale-[0.98]';
</script>

<svelte:head>
	<title>Carretera · Seilide</title>
</svelte:head>

<!-- The next maneuver, big: what to do, and in how much. Over the map, or above the tabs. -->
{#snippet maneuver(where: string)}
	{#if routeBusy === 'reroute'}
		<p class="{where} rounded-2xl bg-zinc-950/90 p-4 text-2xl font-semibold text-amber-300">
			Recalculando la ruta…
		</p>
	{:else if guidance?.arrived && destination}
		<!-- Done: the way out of the route here, not at the top of a long list of steps. -->
		<div class="{where} flex items-center gap-3 rounded-2xl bg-emerald-600/95 p-4 text-white">
			<div class="min-w-0 flex-1">
				<p class="text-2xl font-semibold">Has llegado</p>
				<p class="truncate text-lg">{destination.label}</p>
			</div>
			<button
				class="shrink-0 rounded-xl bg-white px-5 py-3 text-lg font-semibold text-black active:scale-95"
				onclick={clearRoute}>Terminar</button
			>
		</div>
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
					aria-expanded={suggesting &&
						(savedShown.length > 0 || recentShown.length > 0 || suggestionsShown.length > 0)}
					aria-controls="destinos"
					class="w-full rounded-xl border-zinc-700 bg-zinc-950/90 px-4 py-3 text-xl shadow-xl"
					onfocus={() => (suggesting = true)}
					onblur={() => (suggesting = false)}
					onkeydown={(e) => e.key === 'Escape' && (suggesting = false)}
				/>
				{#if suggesting && (savedShown.length || recentShown.length || suggestionsShown.length)}
					<!-- Kept open while touched: the press would blur the box first. -->
					<ul
						id="destinos"
						class="absolute inset-x-0 top-full mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-2xl"
					>
						{#each savedShown as place (place.label)}
							<li>
								<button
									type="button"
									class="flex w-full items-center gap-3 px-4 py-3 text-left text-lg active:bg-zinc-800"
									onpointerdown={(e) => e.preventDefault()}
									onclick={() => choose(place)}
								>
									<!-- Kept with its name, in Viajes. -->
									<svg
										viewBox="0 0 24 24"
										fill="currentColor"
										class="h-6 w-6 shrink-0 text-amber-400"
										aria-hidden="true"
										><path
											d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
										/></svg
									>
									<span class="min-w-0 truncate font-semibold">{place.label}</span>
								</button>
							</li>
						{/each}
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
				class="rounded-xl bg-amber-500 px-5 text-xl font-semibold text-black shadow-xl disabled:opacity-50"
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
				: 'bg-amber-500 text-black active:scale-95',
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
		<span class="text-red-400"
			>Te escucho…{micMode.tap && !voice.handsFree ? ' toca para enviar' : ''}</span
		>
	{:else if voice.phase === 'thinking'}
		<span class="text-zinc-300">Un momento…</span>
	{:else if voice.problem}
		<span class="text-amber-300">{voice.problem}</span>
	{:else if voice.reply}
		{voice.reply}
	{/if}
{/snippet}

<!-- Each tab, drawn: Radio and Música as in the rest of the app; Podcasts as headphones here, as at
home. -->
{#snippet tabIcon(id: Tab, size: string)}
	{#if id === 'radio' || id === 'musica'}
		<SectionIcon name={id} class={size} />
	{:else}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class={size}
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
			{:else if id === 'telegram'}
				<!-- A paper plane, as Telegram's. -->
				<path d="M21 4 3 11l6 2 2 6 3-4 5 4z" />
				<path d="m9 13 12-9" />
			{:else if id === 'llamar'}
				<!-- A handset. -->
				<path
					d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
				/>
			{:else if id === 'mas'}
				<!-- Three dots: the rest. -->
				<circle cx="5" cy="12" r="2" fill="currentColor" />
				<circle cx="12" cy="12" r="2" fill="currentColor" />
				<circle cx="19" cy="12" r="2" fill="currentColor" />
			{:else if id === 'dj'}
				<!-- A record, and the DJ's hand on it. -->
				<circle cx="12" cy="12" r="9" />
				<circle cx="12" cy="12" r="2.5" />
				<path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5" />
			{:else}
				<path
					d="M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 12 3.3a6.5 6.5 0 0 1 6.5 6.5C18.5 14.8 12 21 12 21z"
				/>
				<circle cx="12" cy="9.8" r="2.3" />
			{/if}
		</svg>
	{/if}
{/snippet}

<!--
	The trip at a glance, on the map: each figure always in its place (nothing moving to follow
	with the eyes while driving). The rest, in amber after 2 h without one.
-->
{#snippet tripStrip(where: string)}
	{#if trip.last}
		{@const resting = trip.sinceBreak >= REST_AFTER_SECONDS}
		<div
			class="{where} grid auto-cols-fr grid-flow-col gap-3 rounded-2xl bg-zinc-950/90 px-4 py-2 shadow-xl"
		>
			<div class="min-w-0">
				<p class="text-sm text-zinc-400">Llevas</p>
				<p class="text-xl font-semibold tabular-nums">{kmText(trip.metres)}</p>
			</div>
			{#if nextStop}
				<div class="min-w-0">
					<p class="truncate text-sm text-zinc-400">{nextStop.name}</p>
					<p class="truncate text-xl font-semibold tabular-nums">
						{kmText(nextStop.metres)}{#if nextStop.seconds !== null}
							· {durationText(nextStop.seconds)}{/if}
					</p>
				</div>
			{/if}
			{#if route && guidance && !guidance.arrived}
				<div class="min-w-0">
					<p class="text-sm text-zinc-400">Al destino</p>
					<p class="truncate text-xl font-semibold tabular-nums">
						{kmText(guidance.remaining)}{#if eta}
							· {clock.format(eta.arrival)}{/if}
					</p>
				</div>
			{/if}
			<div class={['min-w-0', resting && 'rounded-xl bg-amber-500 px-2 text-black']}>
				<p class={['text-sm', resting ? 'font-semibold' : 'text-zinc-400']}>
					{resting ? '☕ Descansa' : 'Conduciendo'}
				</p>
				<p class="text-xl font-semibold tabular-nums">
					{durationText(resting ? trip.sinceBreak : trip.moving)}{resting ? ' sin parar' : ''}
				</p>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet lightButton()}
	<button
		class="rounded-full bg-zinc-950/80 px-4 py-2 text-lg text-zinc-100 shadow-lg active:scale-95"
		title="Claro u oscuro: Auto, por el sol; Día; Noche"
		onclick={nextLight}
		>{lightMode === 'auto'
			? `Auto · ${day ? '☀' : '☾'}`
			: lightMode === 'dia'
				? '☀ Día'
				: '☾ Noche'}</button
	>
{/snippet}

<!-- The light, for all of it: the page, the fuel sheet and the dialog (their colours, below). -->
<div class={['road-mode contents', day && 'sol']}>
	<div
		class={[
			'bg-zinc-950 text-zinc-100 select-none',
			mapShown && 'grid h-dvh grid-cols-2 gap-4 p-4'
		]}
	>
		{#if mapShown}
			<div class="relative h-full min-h-0">
				<RoadMap
					{route}
					destination={destination?.at ?? null}
					stops={via}
					onposition={positioned}
					light={day}
					corner={lightButton}
				/>
				{@render maneuver('absolute inset-x-3 top-3')}
				{@render tripStrip('absolute inset-x-3 bottom-16')}
				{@render searchBox()}
			</div>
		{/if}
		<!--
			The right-hand side: on top, the way out (or back) and the section; in the middle, Inicio's
			tiles or the section's list; at the bottom, always the same bar, where the hand falls: what
			plays, ▶, the next one, the volume and the microphone.
		-->
		<div class={['flex flex-col gap-3', mapShown ? 'min-h-0' : 'min-h-dvh p-4']}>
			{#if tab === null}
				<!-- Leaving, and what is on without asking (the wake word, the trip kept): small, not to touch. -->
				<div class="flex flex-wrap items-center gap-2">
					<a
						href="/"
						class="rounded-full bg-zinc-900 px-4 py-2 text-lg text-zinc-200 active:bg-zinc-800"
						aria-label="Salir del modo carretera">← Salir</a
					>
					<div class="ml-auto flex flex-wrap justify-end gap-2">
						{#if wakeWord.on.carretera}
							<span
								class="flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-base text-zinc-300"
								aria-live="polite"
							>
								<span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
								{wakeWord.status === 'loading'
									? 'Preparando…'
									: wakeWord.status === 'tap'
										? 'Toca la pantalla para empezar'
										: `«${WAKE_WORDS[wakeWord.word]}» escucha`}
							</span>
						{/if}
						<!-- Kept or not, and said: where one goes is not kept without knowing it (#81). -->
						{#if data.recordTrips}
							<button
								class="flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 text-base text-zinc-300"
								aria-expanded={tripNote}
								onclick={() => (tripNote = !tripNote)}
							>
								{#if tripRecorder.problem}
									<span
										class="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-black"
										>!</span
									>
									No se guarda el viaje
								{:else}
									<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
									Guardando el viaje
								{/if}
							</button>
						{/if}
					</div>
				</div>
				{#if tripNote && data.recordTrips}
					<p class="text-right text-base text-zinc-400">
						{tripRecorder.problem
							? `No se guarda el viaje: ${tripRecorder.problem}`
							: 'Se guarda este viaje («Guardar mis viajes», en Ajustes).'}
					</p>
				{/if}
			{:else}
				<!-- In a section: the way back, big, and the section's own colour, to know where one is. -->
				{@const back = backTo(tab)}
				<div class="flex items-center gap-3">
					<button class="{big} h-16 gap-2 px-5 text-xl font-semibold" onclick={() => (tab = back)}
						>← {back ? LABELS[back] : 'Inicio'}</button
					>
					<div
						class={['flex h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl px-4', COLOURS[tab]]}
					>
						{@render tabIcon(tab, 'h-9 w-9 shrink-0')}
						<span class="truncate text-2xl font-bold">{LABELS[tab]}</span>
					</div>
				</div>
			{/if}

			<!-- What changes: Inicio or the section, scrolled on its own beside the map. -->
			<div class={['flex flex-col gap-3', mapShown ? 'min-h-0 flex-1 overflow-y-auto' : 'flex-1']}>
				{#if tripShare.url}
					<!-- Shared: said, always in view, with its link and how to stop it (#81). -->
					<div
						class="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-3"
					>
						<span class="mr-auto text-lg text-emerald-300">● Compartiendo tu viaje</span>
						<button
							class="rounded-xl bg-emerald-600 px-4 py-2 text-lg text-white"
							onclick={sendLink}>{copied ? 'Enlace copiado' : 'Enviar enlace'}</button
						>
						<button
							class="rounded-xl bg-zinc-800 px-4 py-2 text-lg"
							onclick={() => void tripShare.stop()}>Dejar de compartir</button
						>
					</div>
				{:else if tripShare.problem}
					<p class="rounded-xl bg-red-950 p-3 text-red-200">{tripShare.problem}</p>
				{/if}

				{#if data.problem}
					<p class="rounded-xl bg-amber-950 p-3 text-amber-200">
						Sin la música de casa: {data.problem} La radio sí funciona.
					</p>
				{/if}

				{#if screenProblem}
					<p class="rounded-xl bg-amber-950 p-3 text-amber-200">{screenProblem}</p>
				{/if}

				{#if tel.state !== 'idle'}
					<!-- A call (#330): in place of everything else, big, until «Cerrar». -->
					<CallPanel wakeWord={wakeWord.on.carretera ? WAKE_WORDS[wakeWord.word] : null} />
				{/if}
				{#if tab === null && tel.state === 'idle'}
					{#if mapInTab && route}
						{#if guidance?.arrived}
							<!-- Not inside the button below: this notice has its own. -->
							{@render maneuver('w-full')}
						{:else}
							<!-- The route goes on out of its section: its next step, and back to the map. -->
							<button class="contents" aria-label="Ver la ruta" onclick={() => (tab = 'ruta')}>
								{@render maneuver('w-full')}
							</button>
						{/if}
					{/if}

					<!-- A big coloured tile for each section: one touch, and its list. -->
					<nav
						class={[
							'grid gap-3',
							mapShown
								? 'min-h-48 flex-1 grid-cols-3 grid-rows-2'
								: 'auto-rows-[7.5rem] grid-cols-2 sm:grid-cols-3'
						]}
						aria-label="Secciones"
					>
						{#each HOME as t (t.id)}
							<button
								class={[
									'relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl font-bold shadow-lg active:scale-95 disabled:opacity-35 disabled:saturate-25',
									COLOURS[t.id]
								]}
								disabled={t.off !== null}
								onclick={() => (tab = t.id)}
							>
								{@render tabIcon(t.id, 'h-12 w-12 short:h-9 short:w-9')}
								<span class="text-xl xl:text-2xl">{LABELS[t.id]}</span>
								{#if t.off}
									<span class="text-base font-normal">{t.off}</span>
								{/if}
							</button>
						{/each}
					</nav>
				{/if}

				{#if tabMap}
					<!-- Kept while a route is followed, out of sight elsewhere: its GPS guides. -->
					<div
						class={tab === 'ruta'
							? 'relative h-[45dvh] shrink-0 short:h-[75dvh]'
							: 'relative h-0 overflow-hidden'}
					>
						<RoadMap
							{route}
							destination={destination?.at ?? null}
							stops={via}
							onposition={positioned}
							light={day}
							corner={lightButton}
						/>
						{@render maneuver('absolute inset-x-3 top-3')}
						{@render searchBox()}
					</div>
				{/if}

				{#if tab !== null && tel.state === 'idle'}
					<!-- The section's list. -->
					<div
						class="grid grid-cols-1 content-start gap-3 sm:grid-cols-2"
						role="region"
						aria-label={LABELS[tab]}
					>
						{#if tab === 'ruta'}
							<div class="flex flex-col gap-3 sm:col-span-2">
								{#if !tripShare.url}
									<!-- Who waits for you, with a link: where you are, live, until you arrive (#81). -->
									<button
										class="rounded-xl bg-zinc-900 px-5 py-3 text-left text-lg text-zinc-200 active:bg-zinc-800 disabled:opacity-50"
										disabled={tripShare.busy}
										onclick={share}>{tripShare.busy ? 'Compartiendo…' : 'Compartir viaje'}</button
									>
								{/if}
								{#if route && destination}
									<div class="rounded-2xl bg-zinc-900 p-4">
										{#if following}
											<p class="truncate text-base text-amber-300">
												Ruta «{following}»{via.length
													? ` · ${via.length} ${via.length === 1 ? 'parada' : 'paradas'} por delante`
													: ''}
											</p>
										{:else if via.length}
											<p class="truncate text-base text-amber-300">
												Por {via
													.map((s) => `${shortName(s.name)}${s.reason ? ` (${s.reason})` : ''}`)
													.join(', ')}
											</p>
										{/if}
										<p class="truncate text-xl font-semibold">{destination.label}</p>
										<p class="text-lg text-zinc-300">
											{distanceText(guidance?.remaining ?? route.distance)}{#if eta}
												· {durationText(eta.seconds)} · llegada a las {clock.format(
													eta.arrival
												)}{/if}
										</p>
										<div class="mt-3 flex flex-wrap gap-2">
											<button
												class="rounded-xl bg-red-700 px-5 py-3 text-lg font-semibold text-white active:bg-red-800"
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
										<!-- Written on the map, parked. -->
										<p class="text-lg text-zinc-400">Escribe el destino en el mapa, parado.</p>
									{/if}
									{#if routeBusy === 'search'}
										<p class="text-lg text-zinc-300">Buscando…</p>
									{/if}
									{#if !here}
										<p class="text-lg text-zinc-400">Esperando a saber dónde estás (el GPS)…</p>
									{/if}
									{#if !places && routeBusy !== 'search'}
										<!-- Kept in Viajes (#151): one touch, from where we are. -->
										{#each data.routes as saved (saved.id)}
											<button
												class="{tile} border-amber-400/30 bg-zinc-900"
												disabled={routeBusy !== null}
												onclick={() => follow(saved)}
											>
												<span class="min-w-0">
													<span class="block truncate text-xl font-semibold">{saved.name}</span>
													<span class="block truncate text-base text-zinc-400"
														>Ruta · {saved.stops.map((s) => s.name).join(' → ')}</span
													>
												</span>
											</button>
										{/each}
										{#each data.places as saved (saved.id)}
											<button
												class="{tile} border-zinc-50/10 bg-zinc-900"
												disabled={routeBusy !== null}
												onclick={() => go({ label: saved.name, at: saved.at })}
											>
												<span class="min-w-0 truncate text-xl font-semibold">{saved.name}</span>
											</button>
										{/each}
									{/if}
									{#each places ?? [] as place (place.label)}
										<button
											class="{tile} border-zinc-50/10 bg-zinc-900"
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
										on ? 'border-emerald-400 bg-emerald-500/15' : 'border-zinc-50/10 bg-zinc-900'
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
							{#if music.current && !music.radio && !music.podcast}
								<!-- The previous song: here, not on the bar, where only the next one fits. -->
								<button
									class="{big} h-16 gap-3 text-xl font-semibold sm:col-span-2"
									onclick={() => music.previous()}
									><MediaIcon name="previous" class="h-8 w-8" /> Anterior</button
								>
							{/if}
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
										on ? 'border-emerald-400 bg-emerald-500/15' : 'border-zinc-50/10 bg-zinc-900'
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
							{#each playlists as playlist (playlist.id)}
								<button
									class="{tile} border-zinc-50/10 bg-zinc-900"
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
						{:else if tab === 'telegram'}
							<button
								class={[
									tile,
									'sm:col-span-2',
									telegramOn ? 'border-sky-400 bg-sky-500/15' : 'border-zinc-50/10 bg-zinc-900'
								]}
								aria-pressed={telegramOn}
								onclick={() => setTelegram(!telegramOn)}
							>
								<span class="text-3xl" aria-hidden="true">{telegramOn ? '🔊' : '🔇'}</span>
								<span class="min-w-0">
									<span class="block text-xl font-semibold"
										>{telegramOn ? 'Leyendo los mensajes' : 'Leer los mensajes en voz alta'}</span
									>
									<span class="block text-base text-zinc-400"
										>{telegramOn
											? 'Cada uno se lee al llegar, con la música más baja'
											: 'Los que te lleguen a Telegram mientras conduces'}</span
									>
								</span>
							</button>
							{#each telegramMessages as m (m.key)}
								<div class="rounded-2xl border-2 border-zinc-50/10 bg-zinc-900 p-3 sm:col-span-2">
									<span class="block text-base text-zinc-400"
										>{m.chat ? `${m.from} · ${m.chat}` : m.from} · {new Date(
											m.at
										).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span
									>
									<span class="block text-lg">{m.text ?? telegramSaid(m)}</span>
								</div>
							{/each}
						{:else if tab === 'dj'}
							{@const setups = [
								...(lastDj ? [{ id: 'dj-ultima', name: 'La última', options: lastDj }] : []),
								...data.djPresets.map((p) => ({
									id: `dj-${p.id}`,
									name: p.name,
									options: p.options
								}))
							]}
							{#each setups as setup (setup.id)}
								{@const on = playingHere(setup.id) && music.dj}
								<button
									class={[
										tile,
										on ? 'border-amber-400 bg-amber-500/15' : 'border-zinc-50/10 bg-zinc-900'
									]}
									disabled={loading !== null}
									onclick={() => startDj(setup.id, setup.options)}
								>
									<span class="min-w-0">
										<span class="block truncate text-xl font-semibold">
											{loading === setup.id ? 'Poniendo…' : setup.name}
										</span>
										<span class="block truncate text-base text-zinc-400"
											>{on
												? music.playing
													? '● Sonando'
													: 'En pausa'
												: djArtists(setup.options.artists)}</span
										>
									</span>
								</button>
							{/each}
							{#if !data.djPresets.length}
								<p class="text-lg text-zinc-400">
									Guarda una configuración en Música → Modo DJ para tenerla aquí.
								</p>
							{/if}
						{:else if tab === 'podcasts'}
							{#if music.podcast}
								<!-- Back and forth in the one that plays; on the bar, only forward. -->
								<div class="grid grid-cols-2 gap-3 sm:col-span-2">
									<button
										class="{big} h-16 text-xl font-semibold"
										aria-label="Atrás {SKIP_BACK} segundos"
										onclick={() => music.skip(-SKIP_BACK)}>−{SKIP_BACK} s</button
									>
									<button
										class="{big} h-16 text-xl font-semibold"
										aria-label="Adelante {SKIP_FORWARD} segundos"
										onclick={() => music.skip(SKIP_FORWARD)}>+{SKIP_FORWARD} s</button
									>
								</div>
							{/if}
							{#each data.inProgress as episode (episode.id)}
								{@const on = music.podcast?.id === episode.id}
								<button
									class={[
										tile,
										on ? 'border-amber-400 bg-amber-500/15' : 'border-zinc-50/10 bg-zinc-900'
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
										on ? 'border-amber-400 bg-amber-500/15' : 'border-zinc-50/10 bg-zinc-900'
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
						{:else if tab === 'llamar'}
							<!-- Who of the family, by their name: one touch, and it rings (#330). -->
							{#each data.callable as p (p.userId)}
								<button
									class={[tile, 'border-zinc-50/10 bg-zinc-900']}
									onclick={() => void tel.call(p.userId, p.name)}
								>
									<span
										class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-2xl font-bold text-white"
										aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span
									>
									<span class="min-w-0">
										<span class="block truncate text-xl font-semibold">{p.name}</span>
										{#if !p.notices}
											<span class="block text-base text-zinc-400"
												>Sin avisos: solo si tiene Seilide abierto</span
											>
										{/if}
									</span>
								</button>
							{/each}
						{:else if tab === 'mas'}
							<!-- What is used less while driving, or stopped: one touch from Inicio, out of its way. -->
							{#if data.callable.length}
								<button
									class={[tile, 'border-zinc-50/10 bg-zinc-900']}
									onclick={() => (tab = 'llamar')}
								>
									<span
										class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl {COLOURS.llamar}"
										>{@render tabIcon('llamar', 'h-8 w-8')}</span
									>
									<span class="min-w-0">
										<span class="block text-xl font-semibold">Llamar</span>
										<span class="block text-base text-zinc-400">A alguien de la familia</span>
									</span>
								</button>
							{/if}
							{#if data.dj}
								<button
									class={[tile, 'border-zinc-50/10 bg-zinc-900']}
									onclick={() => (tab = 'dj')}
								>
									<span
										class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl {COLOURS.dj}"
										>{@render tabIcon('dj', 'h-8 w-8')}</span
									>
									<span class="min-w-0">
										<span class="block text-xl font-semibold">DJ</span>
										<span class="block text-base text-zinc-400">Tus configuraciones de Modo DJ</span
										>
									</span>
								</button>
							{/if}
							{#if data.telegram}
								<button
									class={[tile, 'border-zinc-50/10 bg-zinc-900']}
									onclick={() => (tab = 'telegram')}
								>
									<span
										class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl {COLOURS.telegram}"
										>{@render tabIcon('telegram', 'h-8 w-8')}</span
									>
									<span class="min-w-0">
										<span class="block text-xl font-semibold">Telegram</span>
										<span class="block text-base text-zinc-400">Mensajes leídos en voz alta</span>
									</span>
								</button>
							{/if}
							<!-- A photo towards the road, with where and when (#81). -->
							<button
								class={[tile, 'border-zinc-50/10 bg-zinc-900']}
								disabled={roadPhotos.busy}
								onclick={() => void roadPhotos.take()}
							>
								<span class="text-4xl" aria-hidden="true">📷</span>
								<span class="min-w-0">
									<span class="block text-xl font-semibold"
										>{roadPhotos.busy ? 'Haciendo la foto…' : 'Hacer una foto'}</span
									>
									<span class="block text-base text-zinc-400">O di «haz una foto»</span>
								</span>
							</button>
							<!-- Fuel, stopped at the petrol station (#194): in Gastos, named after where we are. -->
							<button
								class={[tile, 'border-zinc-50/10 bg-zinc-900']}
								onclick={() => (fueling = true)}
							>
								<span class="text-4xl" aria-hidden="true">⛽</span>
								<span class="min-w-0">
									<span class="block text-xl font-semibold">Apuntar gasolina</span>
									<span class="block text-base text-zinc-400"
										>O di «he echado 50 euros de gasolina»</span
									>
								</span>
							</button>
							<!-- The wake word, on this tablet: off until turned on. -->
							<div class="flex flex-col gap-2">
								<button
									class={[
										tile,
										'w-full',
										wakeWord.on.carretera
											? 'border-amber-400 bg-amber-500/15'
											: 'border-zinc-50/10 bg-zinc-900'
									]}
									aria-pressed={wakeWord.on.carretera}
									onclick={() => wakeWord.set('carretera', !wakeWord.on.carretera)}
								>
									<span class="min-w-0">
										<span class="block text-xl font-semibold"
											>Decir «{WAKE_WORDS[wakeWord.word]}»</span
										>
										<span class="block text-base text-zinc-400"
											>{wakeWord.on.carretera
												? 'Sí: se le habla sin tocar la pantalla'
												: 'No: solo con el micrófono'}</span
										>
									</span>
								</button>
								{#if wakeWord.on.carretera && !wakeWord.familyWord}
									<select
										class="rounded-xl border-zinc-700 bg-zinc-900 py-3 text-lg text-zinc-200"
										aria-label="Palabra"
										value={wakeWord.word}
										onchange={(e) => {
											const word = e.currentTarget.value;
											if (isWakeWord(word)) wakeWord.setWord(word);
										}}
									>
										{#each Object.entries(WAKE_WORDS) as [model, name] (model)}
											<option value={model}>{name}</option>
										{/each}
									</select>
								{/if}
							</div>
							<!-- Whether this trip is kept: said, and where it is changed. -->
							<p
								class="rounded-2xl border-2 border-zinc-50/10 bg-zinc-900 p-3 text-lg text-zinc-300"
							>
								{!data.recordTrips
									? 'No se guardan tus viajes: «Guardar mis viajes», en Ajustes.'
									: tripRecorder.problem
										? `No se guarda el viaje: ${tripRecorder.problem}`
										: 'Se guarda este viaje («Guardar mis viajes», en Ajustes).'}
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- What the voice and the rest say: just above the bar, where the eyes already are. -->
			{#if problem}
				<p class="rounded-xl bg-red-950 p-3 text-red-200">{problem}</p>
			{/if}
			{#if wakeWord.on.carretera && wakeWord.problem}
				<p class="text-lg text-amber-300" aria-live="polite">{wakeWord.problem}</p>
			{/if}
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
							class="rounded-full bg-zinc-800 px-6 py-3 text-xl active:bg-amber-500 active:text-black"
							disabled={voice.phase !== 'idle'}
							onclick={() => voice.command(option.command)}>{option.label}</button
						>
					{/each}
				</div>
			{/if}

			<!--
				The bar: the same in Inicio and in every section, each button always in its place. Beside
				▶, the next song, or 30 s further in a podcast; with the radio, an empty place, so ▶ does
				not move. The microphone, the biggest, in the corner nearest the hand.
			-->
			<div
				class={[
					'flex shrink-0 items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 shadow-xl',
					!mapShown && 'sticky bottom-2 z-10'
				]}
			>
				{#if playing}
					{#if playing.image}
						<img
							src={playing.image}
							alt=""
							class="h-16 w-16 shrink-0 rounded-xl bg-zinc-800 object-cover short:h-12 short:w-12"
						/>
					{:else}
						<span
							class={[
								'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl short:h-12 short:w-12',
								COLOURS[playingTab]
							]}>{@render tabIcon(playingTab, 'h-9 w-9')}</span
						>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="truncate text-xl font-semibold">{playing.title}</p>
						<p class="truncate text-base text-zinc-400">{playing.detail}</p>
						{#if progress}
							<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
								<div
									class="h-full rounded-full bg-zinc-300"
									style:width="{(progress.at / progress.duration) * 100}%"
								></div>
							</div>
						{/if}
					</div>
				{:else}
					<p class="min-w-0 flex-1 truncate pl-2 text-lg text-zinc-400">No suena nada</p>
				{/if}
				<button
					class="{big} h-16 w-16 rounded-full bg-zinc-100! text-zinc-950! short:h-14 short:w-14"
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					disabled={!playing}
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} class="h-9 w-9" /></button
				>
				{#if music.podcast}
					<button
						class="{big} h-14 w-14 rounded-full text-lg font-semibold"
						aria-label="Adelante {SKIP_FORWARD} segundos"
						onclick={() => music.skip(SKIP_FORWARD)}>+{SKIP_FORWARD}</button
					>
				{:else if playing && !music.radio}
					<button
						class="{big} h-14 w-14 rounded-full"
						aria-label="Siguiente"
						disabled={music.index >= music.queue.length - 1 && !music.repeat}
						onclick={() => music.next()}><MediaIcon name="next" class="h-8 w-8" /></button
					>
				{:else}
					<span class="hidden h-14 w-14 shrink-0 sm:block" aria-hidden="true"></span>
				{/if}
				<!-- The music's volume, here only: the tablet's buttons, loud, are for the voice. Not on a
				phone upright: no room, and its own buttons are at hand. -->
				<div
					class="hidden shrink-0 flex-col items-center sm:flex"
					title="La música, aquí; la voz, con los botones de la tablet"
				>
					<button
						class="{big} h-9 w-12 rounded-xl text-2xl"
						aria-label="Música más alta"
						disabled={carVolume >= 1}
						onclick={() => changeCarVolume(CAR_VOLUME_STEP)}>+</button
					>
					<span class="text-sm text-zinc-400 tabular-nums" aria-label="Volumen de la música"
						>{Math.round(carVolume * 100)}</span
					>
					<button
						class="{big} h-9 w-12 rounded-xl text-2xl"
						aria-label="Música más baja"
						disabled={carVolume <= 0}
						onclick={() => changeCarVolume(-CAR_VOLUME_STEP)}>−</button
					>
				</div>
				{@render mic(
					'h-20 w-20 sm:h-24 sm:w-24 short:h-16 short:w-16',
					'h-10 w-10 sm:h-12 sm:w-12 short:h-9 short:w-9'
				)}
			</div>
		</div>
	</div>

	<!-- Fuel (#194): over everything, as the photo just taken. -->
	{#if fueling}
		<FuelSheet
			position={here}
			onclose={() => (fueling = false)}
			urls={{ read: '/gastos/leer', save: '/api/gastos/gasolina' }}
		/>
	{/if}

	{#if roadPhotos.last}
		<!-- The photo just taken, for a moment: whether it came out well, and whether it was kept. -->
		<figure
			class="fixed right-4 bottom-4 z-40 w-72 overflow-hidden rounded-2xl border-2 border-zinc-50/20 bg-zinc-900 shadow-2xl"
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

	<!-- Leaving, asked (see beforeNavigate): big, for a glance; «Seguir» first, and by itself. -->
	<dialog
		bind:this={exitDialog}
		closedby="any"
		onclose={() => {
			clearTimeout(exitTimer);
			exitOpen = false;
		}}
		class="m-auto w-md max-w-[calc(100vw-2rem)] rounded-3xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-lg backdrop:bg-zinc-950/80"
	>
		<h2 class="text-2xl font-bold">¿Salir del modo carretera?</h2>
		{#if data.recordTrips}
			<p class="mt-2 text-lg text-zinc-400">Se deja de guardar el viaje.</p>
		{/if}
		<div class="mt-5 grid grid-cols-2 gap-3">
			<button class="{big} h-20 text-2xl font-semibold" onclick={() => exitDialog?.close()}
				>Seguir</button
			>
			<button
				class="flex h-20 items-center justify-center rounded-2xl bg-red-700 text-2xl font-semibold text-white active:scale-95 active:bg-red-800"
				onclick={exit}>Salir</button
			>
		</div>
		{#if exitOpen}
			<div
				class="exit-countdown mt-5 h-1.5 rounded-full bg-amber-400"
				style:animation-duration="{EXIT_ASK_MS}ms"
			></div>
		{/if}
	</dialog>

	<!-- The sound plays through MusicBar's <audio>; its bar is for the rest of the app. -->
	<div class="hidden"><MusicBar /></div>
</div>

<style>
	/*
	 * All of the road mode a bit bigger, read at a glance from the seat: sizes and spaces are in rem,
	 * so this is the one number to change. Only while this page is open.
	 */
	:global(html:has(.road-mode)) {
		font-size: 112.5%;
	}

	/*
	 * By day (#sol): what is near black turns white and the other way round, and the colours of the
	 * notices darken, so the same classes read in the sun. Tailwind's own values
	 * (tailwindcss/theme.css); black and white stay, for the letters on amber and on green or red.
	 */
	.sol {
		color-scheme: light;
		font-weight: 500;
		--color-zinc-950: #fff;
		--color-zinc-900: oklch(92% 0.004 286.32);
		--color-zinc-800: oklch(87.1% 0.006 286.286);
		--color-zinc-700: oklch(70.5% 0.015 286.067);
		--color-zinc-600: oklch(55.2% 0.016 285.938);
		--color-zinc-500: oklch(44.2% 0.017 285.786);
		--color-zinc-400: oklch(37% 0.013 285.805);
		--color-zinc-300: oklch(27.4% 0.006 286.033);
		--color-zinc-200: oklch(21% 0.006 285.885);
		--color-zinc-100: #000;
		--color-zinc-50: #000;
		--color-amber-200: oklch(41.4% 0.112 45.904);
		--color-amber-300: oklch(47.3% 0.137 46.201);
		--color-amber-400: oklch(55.5% 0.163 48.998);
		--color-amber-950: oklch(96.2% 0.059 95.617);
		--color-red-200: oklch(39.6% 0.141 25.723);
		--color-red-300: oklch(44.4% 0.177 26.899);
		--color-red-400: oklch(50.5% 0.213 27.518);
		--color-red-950: oklch(93.6% 0.032 17.717);
		--color-emerald-300: oklch(43.2% 0.095 166.913);
		--color-emerald-400: oklch(50.8% 0.118 165.612);
		--color-sky-400: oklch(50% 0.134 242.749);
	}

	/* «Seguir» by itself when it runs out. */
	.exit-countdown {
		animation-name: exit-countdown;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	@keyframes exit-countdown {
		from {
			width: 100%;
		}
		to {
			width: 0;
		}
	}
</style>
