import { onMount, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { music } from './music-player.svelte.ts';
import { RESUME_END_SEC, resumable, type MusicTrack } from './music.ts';

/**
 * Where each long audio without an album was left (a podcast downloaded, a talk: music.ts
 * `resumable`), kept on the server (/api/music/progress: the house's, and Seilide asks it) to go
 * on from there on any device: while it plays, on pause, on going to another, on leaving the page
 * and at its end (forgotten, to start again the next time). Songs are not kept: they start again.
 */

/** While it plays, this often; on pause and on leaving it, at once. */
const EVERY_MS = 15_000;
/**
 * Less than this into it is only having started (or not yet taken where it was): not kept, so as
 * not to lose where it was.
 */
const MIN_SEC = 5;

/** Track id → seconds, this person's: what the server said, and what was heard here since. */
const positions = new SvelteMap<number, number>();

/** Where `t` starts: where it was left, or the beginning. */
export function resumeAt(t: MusicTrack) {
	return resumable(t) ? (positions.get(t.id) ?? 0) : 0;
}

/** Heard here, not yet sent: it stays over an older answer of the server. */
let pending: { id: number; sec: number } | null = null;
/** The last one sent, not to send it again (the end, said at every tick of its last seconds). */
let sent: { id: number; sec: number } | null = null;
/** When the last one was sent; on starting an audio, then, so it waits a while to say anything. */
let sentAt = 0;
let asking: Promise<void> | null = null;

/** Asked again (it may have been heard elsewhere since); one question at a time. */
export function refreshProgress(): Promise<void> {
	asking ??= fetch('/api/music/progress')
		.then((res) => (res.ok ? res.json() : null))
		.then((body: { progress?: Record<string, number> } | null) => {
			if (!body?.progress) return;
			positions.clear();
			for (const [id, sec] of Object.entries(body.progress)) positions.set(Number(id), sec);
			if (pending) keep(pending);
		})
		.catch(() => {})
		.finally(() => (asking = null));
	return asking;
}

function keep({ id, sec }: { id: number; sec: number }) {
	if (sec > 0) positions.set(id, sec);
	else positions.delete(id);
}

/** One after the other, so they arrive in order. */
let saving = Promise.resolve();

function send() {
	const now = pending;
	if (!now || (sent?.id === now.id && sent.sec === now.sec)) return;
	sent = now;
	sentAt = Date.now();
	pending = null;
	keep(now);
	saving = saving.then(() =>
		// keepalive: the one from pagehide still arrives after the page has gone.
		fetch('/api/music/progress', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ trackId: now.id, positionSec: now.sec }),
			keepalive: true
		}).then(
			() => {},
			() => {}
		)
	);
}

/** Where `t` is now, from MusicBar while it sounds (its own `<audio>`, not another's). */
export function heardTrack(t: MusicTrack, sec: number, durationSec: number | null) {
	if (!resumable(t)) return;
	const end = (durationSec ?? t.durationSec ?? 0) - RESUME_END_SEC;
	const at = sec >= end ? 0 : sec;
	if (at > 0 && at < MIN_SEC) return;
	const first = pending?.id !== t.id && sent?.id !== t.id;
	pending = { id: t.id, sec: at };
	if (first) sentAt = Date.now();
	else if (at === 0 || Date.now() - sentAt >= EVERY_MS) send();
}

/** Call it while the component with the `<audio>` (MusicBar) is being created. */
export function keepTrackProgress() {
	onMount(() => {
		void refreshProgress();
		const leave = () => send();
		const back = () => {
			if (document.visibilityState === 'visible') void refreshProgress();
		};
		addEventListener('pagehide', leave);
		document.addEventListener('visibilitychange', back);
		return () => {
			removeEventListener('pagehide', leave);
			document.removeEventListener('visibilitychange', back);
		};
	});

	// Paused: where it is, at once.
	$effect(() => {
		if (!music.playing) untrack(send);
	});

	// Another one, or closed: where this one was left.
	$effect(() => {
		void music.current?.id;
		return () => send();
	});
}
