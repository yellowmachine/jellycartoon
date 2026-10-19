<script lang="ts">
	import { untrack } from 'svelte';
	import type Hls from 'hls.js';
	import type { WatchingNow } from '#lib/server/live-watching.ts';

	/**
	 * A small, silent copy of what a child watches (#75), beside /infantil's «Ahora»: not their
	 * screen, but the same video at the same second, following it. Films and episodes come made
	 * small by the server (/infantil/espejo); a channel, live, at its lowest quality.
	 */
	let { now, checkedAt }: { now: WatchingNow; checkedAt: number } = $props();

	/** Further apart than this, it starts again where the child is: they skipped, or it lagged. */
	const DRIFT_SEC = 10;
	const CHECK_MS = 2000;

	let video = $state<HTMLVideoElement>();
	/** The second the current copy started from; its own time is counted from there. */
	let from = $state(0);
	let src = $state<string | null>(null);
	let tick = $state(0);

	const target = $derived(
		'episodeId' in now.mirror
			? `episode=${now.mirror.episodeId}`
			: 'movieId' in now.mirror
				? `movie=${now.mirror.movieId}`
				: null
	);

	/** Where the child is by now: where they were when it was sent, plus what has played since. */
	function childAt() {
		if (now.positionSec === null) return 0;
		if (now.paused) return now.positionSec;
		return now.positionSec + now.ageSec + (Date.now() - checkedAt) / 1000;
	}

	function start() {
		from = Math.floor(childAt());
		src = `/infantil/espejo?${target}&t=${from}`;
	}

	// Another video: from where the child is. Only on that: each check moves the position too.
	$effect(() => {
		if (target) untrack(start);
	});

	$effect(() => {
		const timer = setInterval(() => tick++, CHECK_MS);
		return () => clearInterval(timer);
	});

	// Following the child: again from where they are if far apart, and paused with them, on the
	// frame where they stopped (it is known some seconds late, when the position stops moving).
	$effect(() => {
		void tick;
		if (!video || !target) return;
		const here = from + video.currentTime;
		if (Math.abs(childAt() - here) > DRIFT_SEC) start();
		else if (now.paused) video.pause();
		else if (video.paused) void video.play().catch(() => {});
	});

	// A channel: hls.js, as the channels page, at the smallest quality it has. Safari, its own.
	$effect(() => {
		const el = video;
		if (!el || !('channelUrl' in now.mirror)) return;
		const url = now.mirror.channelUrl;
		let hls: Hls | null = null;
		let cancelled = false;
		(async () => {
			if (el.canPlayType('application/vnd.apple.mpegurl')) {
				el.src = url;
				return;
			}
			const { default: Hls } = await import('hls.js');
			if (cancelled || !Hls.isSupported()) return;
			// https://github.com/video-dev/hls.js/blob/master/docs/API.md#capleveltoplayersize
			hls = new Hls({ startLevel: 0, capLevelToPlayerSize: true });
			hls.loadSource(url);
			hls.attachMedia(el);
		})();
		return () => {
			cancelled = true;
			hls?.destroy();
		};
	});
</script>

<video
	bind:this={video}
	src={target ? src : undefined}
	class="aspect-video w-full max-w-xs rounded bg-black object-contain"
	muted
	autoplay
	onplaying={() => now.paused && video?.pause()}
	playsinline
	disablepictureinpicture
	aria-label="Lo que está viendo, sin sonido"
></video>
