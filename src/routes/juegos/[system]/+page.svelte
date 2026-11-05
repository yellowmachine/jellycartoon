<script lang="ts">
	import { page } from '$app/state';
	import GameList from 'comun/components/games/GameList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.name} · Juegos · JellyCartoon</title>
</svelte:head>

<GameList system={page.params.system!} name={data.name} games={data.games} covers={data.covers} />
