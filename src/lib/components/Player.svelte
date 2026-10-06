<script lang="ts">
	interface Props {
		episodeId: number;
		startAt?: number | null;
		autoplay?: boolean;
		/** Called after the final position has been saved. */
		onended?: () => void;
	}

	let { episodeId, startAt = 0, autoplay = true, onended }: Props = $props();
	let video = $state<HTMLVideoElement>();
	let lastSaved = 0;

	function save() {
		if (!video?.currentTime) return Promise.resolve();
		lastSaved = Date.now();
		// keepalive lets the request finish even if the page is being closed.
		return fetch('/api/progress', {
			method: 'POST',
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				episodeId,
				positionSec: video.currentTime,
				durationSec: video.duration
			})
		}).catch(() => {});
	}

	function onLoaded() {
		if (!video) return;
		if (startAt && startAt > 5) video.currentTime = startAt;
		if (autoplay) video.play().catch(() => {});
	}

	function onTimeUpdate() {
		if (Date.now() - lastSaved > 10_000) save();
	}

	async function onEnded() {
		await save();
		onended?.();
	}
</script>

<svelte:window onpagehide={save} />

{#key episodeId}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		src="/api/stream/{episodeId}"
		poster="/api/thumb/{episodeId}"
		controls
		preload="metadata"
		class="aspect-video w-full rounded-md bg-black"
		onloadedmetadata={onLoaded}
		ontimeupdate={onTimeUpdate}
		onpause={save}
		onseeked={save}
		onended={onEnded}
	></video>
{/key}
