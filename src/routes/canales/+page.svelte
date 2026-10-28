<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import LivePlayer from 'comun/components/LivePlayer.svelte';
	import { channelWash, type Channel } from 'comun/channels.ts';
	import { shownDeviceName } from 'comun/device-name.svelte.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The one on here; none until one is chosen. */
	let watching = $state<Channel | null>(null);

	function watch(channel: Channel) {
		music.stop();
		watching = channel;
		scrollTo({ top: 0, behavior: 'smooth' });
	}

	/**
	 * Where it is, every few seconds (/api/progress): a child's time (#18), and what is watched. Out
	 * of time, «/descanso»; not if the channel was left meanwhile, which would take the user away
	 * from wherever they went.
	 */
	async function report(channel: Channel, positionSec: number) {
		const res = await fetch('/api/progress', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ channelId: channel.id, positionSec, device: shownDeviceName(false) })
		}).catch(() => null);
		if (res?.status === 403 && watching?.id === channel.id) void goto('/descanso');
	}

	/** Like an episode's: the microphone and a kitchen timer pause it, the kitchen panel shows it. */
	function here(channel: Channel) {
		return (element: HTMLVideoElement) => {
			videoHere.set({ episodeId: null, title: channel.name, element });
			return () => videoHere.clear(element);
		};
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
			{@const channel = watching}
			<LivePlayer
				url={channel.url}
				subtitleStyle={data.subtitleStyle}
				here={here(channel)}
				report={(positionSec) => report(channel, positionSec)}
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
