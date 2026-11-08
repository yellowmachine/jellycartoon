<script lang="ts">
	import { beforeNavigate, goto, pushState } from '$app/navigation';
	import GamePlayer from 'comun/components/GamePlayer.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<GamePlayer data={data.player} nav={{ beforeNavigate, goto, pushState }} web />
