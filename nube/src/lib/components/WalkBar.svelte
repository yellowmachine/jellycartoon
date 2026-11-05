<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { walkRecorder as walk } from '#lib/walk-recorder.svelte.ts';
	import { clockText, walkDistanceText } from '#lib/walks.ts';

	/**
	 * A walk going on (#410), in the header of any other page, as one goes to Música and comes back.
	 * Also where it starts up again if the page was closed.
	 */
	let { userId }: { userId: string } = $props();

	$effect(() => {
		const id = userId;
		untrack(() => walk.open(id));
	});

	let now = $state(Date.now());
	$effect(() => {
		if (!walk.recording) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
</script>

{#if walk.recording && page.url.pathname !== '/paseos'}
	<div>
		<a
			href="/paseos"
			class="flex items-center gap-2 rounded-md border border-emerald-600/50 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200"
		>
			<span aria-hidden="true">🚶</span>
			<span class="font-medium">Paseo en marcha</span>
			<span class="ml-auto tabular-nums">
				{clockText((now - walk.startedAt!) / 1000)} · {walkDistanceText(walk.distance)}
			</span>
		</a>
	</div>
{/if}
