<script lang="ts">
	import LivePlayer from 'comun/components/LivePlayer.svelte';
	import { channelWash, type Channel } from 'comun/channels.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * TV channels, live (#253), as jellycartoon's /canales: a card each, and the one chosen playing
	 * above, with its audios and subtitles. Without the house's «En el salón»: that is at home.
	 */
	let { data }: PageProps = $props();

	/** The one on here; none until one is chosen. */
	let watching = $state<Channel | null>(null);

	function watch(channel: Channel) {
		music.stop();
		watching = channel;
		scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<svelte:head>
	<title>Canales · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Canales</h1>
<p class="mb-6 text-sm text-zinc-400">
	En directo, de aquí y de fuera. Muchos tienen versión original o subtítulos, también en inglés.
</p>

{#if watching}
	<section class="mb-8">
		<h2 class="mb-2 font-semibold">
			{watching.name} <span class="text-sm font-normal text-zinc-400">· En directo</span>
		</h2>
		{#key watching.id}
			<LivePlayer url={watching.url} subtitleStyle={data.subtitleStyle} />
		{/key}
	</section>
{/if}

<div class="grid gap-3 sm:grid-cols-2">
	{#each data.channels as channel (channel.id)}
		{@const on = watching?.id === channel.id}
		<div
			class={[
				'flex items-center gap-3 rounded-md border p-3',
				on ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-800'
			]}
			style:background-image={channelWash(channel)}
		>
			<button class="min-w-0 flex-1 text-left" onclick={() => watch(channel)}>
				<span class="block font-semibold">{channel.name}</span>
				<span class="block text-sm text-zinc-400">{channel.description}</span>
			</button>
		</div>
	{/each}
</div>
