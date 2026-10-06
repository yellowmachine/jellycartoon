<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let video = $state<HTMLVideoElement>();
	let lastSaved = 0;

	function save() {
		if (!video || !video.currentTime) return;
		lastSaved = Date.now();
		const body = JSON.stringify({
			episodeId: data.episode.id,
			positionSec: video.currentTime,
			durationSec: video.duration
		});
		// sendBeacon survives page unloads; fetch is the fallback.
		if (!navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }))) {
			fetch('/api/progress', {
				method: 'POST',
				body,
				headers: { 'content-type': 'application/json' }
			});
		}
	}

	function onLoaded() {
		const start = data.episode.positionSec ?? 0;
		if (!video) return;
		if (start > 5) video.currentTime = start;
		video.play().catch(() => {});
	}

	function onTimeUpdate() {
		if (Date.now() - lastSaved > 10_000) save();
	}

	function onEnded() {
		save();
		if (data.nextId) goto(`/watch/${data.nextId}`);
	}
</script>

<svelte:window onpagehide={save} />

<div class="mb-4">
	<a href="/series/{data.episode.seriesId}" class="text-sm text-zinc-400 hover:text-white">
		← {data.episode.seriesTitle}
	</a>
	<h1 class="text-xl font-semibold">
		T{data.episode.season} E{data.episode.number} · {data.episode.title}
	</h1>
</div>

{#key data.episode.id}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		src="/api/stream/{data.episode.id}"
		poster="/api/thumb/{data.episode.id}"
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

{#if data.nextId}
	<div class="mt-4 text-right">
		<a href="/watch/{data.nextId}" class="text-sm text-amber-400 hover:underline">
			Siguiente episodio →
		</a>
	</div>
{/if}
