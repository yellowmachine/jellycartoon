import { languageLabel } from '#lib/languages.ts';
import type { RemoteAction, RemoteState, Track } from '#lib/salon.ts';

/**
 * Live state of the mpv on the host, from /api/salon/events. Call it while a component is being
 * created: the connection closes when the component goes away.
 */
export function watchSalon() {
	let state = $state<RemoteState | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		// EventSource reconnects by itself if the connection drops.
		const source = new EventSource('/api/salon/events');
		source.onmessage = (event) => (state = JSON.parse(event.data));
		return () => source.close();
	});

	return {
		get state() {
			return state;
		},
		/** The last command that failed, e.g. mpv is not running. */
		get error() {
			return error;
		},
		async send(action: RemoteAction) {
			const res = await fetch('/api/salon', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(action)
			}).catch(() => null);
			error = res?.ok ? null : ((await res?.json().catch(() => null))?.message ?? 'Sin conexión');
		}
	};
}

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'estéreo', 6: '5.1', 8: '7.1' };

/** e.g. `Español · 5.1` or `English · Commentary`; `forzados` for forced subtitles. */
export function trackLabel(track: Track) {
	return [
		languageLabel(track.lang),
		track.title,
		track.channels ? CHANNELS[track.channels] : null,
		track.forced ? 'forzados' : null
	]
		.filter(Boolean)
		.join(' · ');
}
