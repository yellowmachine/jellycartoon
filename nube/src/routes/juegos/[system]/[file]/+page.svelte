<script lang="ts">
	import { page } from '$app/state';
	import GameCard from 'comun/components/games/GameCard.svelte';
	import CarryGame from '#lib/components/CarryGame.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.game.title} · Seilide</title>
</svelte:head>

<GameCard
	system={page.params.system!}
	file={page.params.file!}
	game={data.game}
	backdrop={data.backdrop}
	info={data.info}
/>

<!-- Carried away, only the house's for now (#564, phase 2). -->
{#if !data.own}
	<CarryGame
		system={page.params.system!}
		file={page.params.file!}
		view={data.offline}
		problem={form?.offline ?? null}
	/>
{/if}
