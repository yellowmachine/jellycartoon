<script lang="ts">
	import { enhance } from '$app/forms';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { CHANNELS } from '#lib/channels.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let loading = $state<string | null>(null);
</script>

<svelte:head>
	<title>Canales · JellyCartoon</title>
</svelte:head>

<TvHeader title="Canales" />

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

<div class="grid grid-cols-2 gap-8">
	{#each CHANNELS as channel (channel.id)}
		<form
			method="post"
			action="?/play"
			use:enhance={() => {
				music.stop();
				loading = channel.id;
				return async ({ update }) => {
					await update();
					loading = null;
				};
			}}
		>
			<input type="hidden" name="id" value={channel.id} />
			<button
				class="flex h-40 w-full flex-col justify-center rounded-2xl border-2 border-white/10 bg-zinc-900 px-8 text-left transition duration-150 focus-visible:scale-105 focus-visible:border-orange-400 focus-visible:bg-zinc-800"
				disabled={loading !== null}
			>
				<span class="block text-5xl font-bold text-orange-300">{channel.name}</span>
				<span class="mt-2 block text-xl text-zinc-400"
					>{loading === channel.id ? 'Sintonizando…' : channel.description}</span
				>
			</button>
		</form>
	{/each}
</div>
