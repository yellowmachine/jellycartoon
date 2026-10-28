import { onMount, untrack } from 'svelte';
import { music } from './music-player.svelte.ts';
import type { PodcastPlaying } from './podcasts.ts';

/**
 * Where the user is in the podcast episode that plays, kept on the server to go on from there on
 * any device: while it plays, on pause, on leaving it for another or closing, on leaving the page
 * and at its end. The position is the episode's own (MusicBar keeps it there), not the player's:
 * while one is changed for another, the `<audio>` still says where the old one was.
 */

const EVERY_MS = 15_000;

/** The one that got to its end: saved as listened to, not again where it stopped. */
let endedId: number | null = null;

/**
 * One after the other, so they arrive in order: at the end, the pause is saved a moment before
 * «listened to», and arriving after it would undo it.
 */
let saving = Promise.resolve();

function save(episodeId: number, positionSec: number, ended = false) {
	saving = saving.then(() =>
		// keepalive: the one from pagehide still arrives after the page has gone.
		fetch(`/api/podcasts/episodes/${episodeId}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ positionSec, ended }),
			keepalive: true
		}).then(
			() => {},
			() => {}
		)
	);
}

/**
 * Plays an episode in this browser, from where the user left it (asked for now: the page may be
 * older than what was listened to elsewhere). Why not, if it cannot be.
 */
export async function playEpisode(episodeId: number): Promise<string | null> {
	const res = await fetch(`/api/podcasts/episodes/${episodeId}`).catch(() => null);
	if (!res?.ok) return 'No se pudo cargar el episodio.';
	const episode: PodcastPlaying = await res.json();
	music.playPodcast(episode);
	return null;
}

/** The episode got to its end: listened to, and the player closes. */
export function podcastEnded() {
	if (!music.podcast) return;
	endedId = music.podcast.id;
	save(music.podcast.id, music.podcast.positionSec, true);
	music.stop();
}

/** Call it while the component with the `<audio>` (MusicBar) is being created. */
export function keepPodcastProgress() {
	onMount(() => {
		const leave = () => {
			if (music.podcast && music.playing) save(music.podcast.id, music.podcast.positionSec);
		};
		addEventListener('pagehide', leave);
		return () => removeEventListener('pagehide', leave);
	});

	$effect(() => {
		const episode = music.podcast;
		const playing = music.playing;
		// Brought back paused from another device: nothing new to say until it is played.
		if (!episode || untrack(() => music.restored)) return;
		const now = () =>
			save(
				episode.id,
				untrack(() => episode.positionSec)
			);
		if (episode.id === endedId) endedId = null;
		let timer: ReturnType<typeof setInterval> | undefined;
		if (playing) timer = setInterval(now, EVERY_MS);
		else if (untrack(() => episode.positionSec) > 0) now();
		return () => {
			clearInterval(timer);
			// Another one, or closed: where this one was left.
			if (music.podcast?.id !== episode.id && endedId !== episode.id) now();
		};
	});
}
