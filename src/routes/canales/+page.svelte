<script lang="ts">
	import { enhance } from '$app/forms';
	import LivePlayer from '#lib/components/LivePlayer.svelte';
	import { channelWash, type Channel } from '#lib/channels.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The one on here; none until one is chosen. */
	let watching = $state<Channel | null>(null);

	function watch(channel: Channel) {
		music.stop();
		watching = channel;
		scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<svelte:head>
	<title>Canales · JellyCartoon</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Canales</h1>
<p class="mb-6 text-sm text-zinc-400">
	{data.kid
		? 'Clan y SX3, en directo.'
		: 'En directo, de aquí y de fuera. Muchos tienen versión original o subtítulos, también en inglés.'}
</p>

{#if form && 'message' in form}
	<p class="mb-4 text-sm text-red-400">{form.message}</p>
{:else if form && 'salon' in form}
	<p class="mb-4 text-sm text-amber-400">
		{form.salon} en el salón. <a href="/salon" class="underline">Mando →</a>
	</p>
{/if}

{#if watching}
	<section class="mb-8">
		<h2 class="mb-2 font-semibold">
			{watching.name} <span class="text-sm font-normal text-zinc-400">· En directo</span>
		</h2>
		{#key watching.id}
			<LivePlayer
				channelId={watching.id}
				title={watching.name}
				url={watching.url}
				subtitleStyle={data.subtitleStyle}
			/>
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
			{#if data.salon}
				<form
					method="post"
					action="?/salon"
					use:enhance={() => {
						// One screen at a time: what was on here stops.
						if (on) watching = null;
						return async ({ update }) => update();
					}}
				>
					<input type="hidden" name="id" value={channel.id} />
					<button
						class="shrink-0 rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
						title="Ponerlo en la tele del salón">En el salón</button
					>
				</form>
			{/if}
		</div>
	{/each}
</div>
