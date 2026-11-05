<script lang="ts">
	import { beforeNavigate, goto, pushState } from '$app/navigation';
	import { page } from '$app/state';
	import GamePlayer from 'comun/components/GamePlayer.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<GamePlayer
	{data}
	nav={{ beforeNavigate, goto, pushState }}
	saveId={Number(page.url.searchParams.get('partida'))}
/>
