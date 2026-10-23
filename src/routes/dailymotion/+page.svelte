<script lang="ts">
	import DmVideoCard from '#lib/components/DmVideoCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Dailymotion · JellyCartoon</title>
</svelte:head>

<h1 class="mb-6 text-2xl font-bold">Dailymotion</h1>

{#if data.halfway.length}
	<h2 class="mb-3 font-semibold text-zinc-300">Seguir viendo</h2>
	<ul class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each data.halfway as video (video.id)}
			<li><DmVideoCard {video} positionSec={video.positionSec} /></li>
		{/each}
	</ul>
{/if}

{#if data.sources.length}
	<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
		{#each data.sources as source (source.id)}
			<li>
				<a
					href="/dailymotion/{source.id}"
					class="flex flex-col items-center gap-2 rounded-md p-3 text-center hover:bg-zinc-900"
				>
					{#if source.image}
						<img
							src={source.image}
							alt=""
							referrerpolicy="no-referrer"
							class={[
								'h-24 w-24 bg-zinc-800 object-cover',
								source.kind === 'user' ? 'rounded-full' : 'rounded-md'
							]}
						/>
					{:else}
						<span class="h-24 w-24 rounded-full bg-zinc-800"></span>
					{/if}
					<span class="line-clamp-2 text-sm">{source.name}</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-zinc-400">
		Todavía no hay cuentas de Dailymotion para ver.
		{#if data.canChoose}
			Elígelas en <a href="/infantil#dailymotion" class="text-amber-400 hover:underline">Infantil</a
			>.
		{:else}
			Pídeselo a un adulto.
		{/if}
	</p>
{/if}
