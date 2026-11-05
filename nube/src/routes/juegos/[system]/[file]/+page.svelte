<script lang="ts">
	import { page } from '$app/state';
	import GameCard from 'comun/components/games/GameCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
