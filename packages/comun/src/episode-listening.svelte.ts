import { goto } from '$app/navigation';
import { onMount, untrack } from 'svelte';
import { shownDeviceName } from './device-name.svelte.ts';
import { audioTrackFor, episodeAudioUrl, type EpisodeListening } from './episode-audio.ts';
import type { AudioTrack } from './languages.ts';
import { music } from './music-player.svelte.ts';
import { thumbUrl } from './thumb.svelte.ts';

/**
 * An episode only listened to (#154): started from its «⋯» menu or from the player, and its
 * progress saved as when it is watched (/api/progress): «Seguir viendo» goes on from there, with
 * the video or without it. While it plays, on pause, on leaving it and at its end.
 */

const EVERY_MS = 15_000;

/** One after the other, so they arrive in order: at its end, the last one says it was watched. */
let saving = Promise.resolve();

function save(episode: EpisodeListening, positionSec: number) {
	saving = saving.then(() =>
		// keepalive: the one from pagehide still arrives after the page has gone.
		fetch('/api/progress', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				episodeId: episode.id,
				positionSec,
				durationSec: episode.durationSec,
				device: shownDeviceName(false)
			}),
			keepalive: true
		}).then(
			(res) => {
				// 403: a child's time is over (not offered to them; just in case).
				if (res.status === 403 && music.listening?.id === episode.id) {
					music.stop();
					void goto('/descanso');
				}
			},
			() => {}
		)
	);
}

/**
 * Its audio in the music player, from `positionSec`: the track in `lang` (Ajustes, or the one
 * being heard in the player), or the first.
 */
export function listenToEpisode(episode: {
	id: number;
	title: string;
	subtitle: string;
	audioTracks: AudioTrack[];
	lang: string | null;
	durationSec: number | null;
	positionSec: number;
	track?: number;
}) {
	const track = episode.track ?? audioTrackFor(episode.audioTracks, episode.lang);
	music.listenTo({
		id: episode.id,
		title: episode.title,
		subtitle: episode.subtitle,
		audioUrl: episodeAudioUrl(episode.id, track),
		imageUrl: thumbUrl(episode.id),
		durationSec: episode.durationSec,
		positionSec: episode.positionSec
	});
}

/** It got to its end: saved as watched (its whole length), and the player closes. */
export function listeningEnded() {
	const episode = music.listening;
	if (!episode) return;
	save(episode, episode.durationSec ?? episode.positionSec);
	music.stop();
}

/** Call it while the component with the `<audio>` (MusicBar) is being created. */
export function keepListeningProgress() {
	onMount(() => {
		const leave = () => {
			if (music.listening && music.playing) save(music.listening, music.listening.positionSec);
		};
		addEventListener('pagehide', leave);
		return () => removeEventListener('pagehide', leave);
	});

	$effect(() => {
		const episode = music.listening;
		const playing = music.playing;
		if (!episode) return;
		const now = () =>
			save(
				episode,
				untrack(() => episode.positionSec)
			);
		let timer: ReturnType<typeof setInterval> | undefined;
		if (playing) timer = setInterval(now, EVERY_MS);
		else if (untrack(() => episode.positionSec) > 0) now();
		return () => {
			clearInterval(timer);
			// Another one, or closed (not at its end, which listeningEnded saves): where it was.
			if (music.listening !== episode && untrack(() => episode.positionSec) > 0) now();
		};
	});
}
