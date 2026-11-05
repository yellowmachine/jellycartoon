<script lang="ts">
	import GamePlayer from '#lib/components/GamePlayer.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<GamePlayer {data} web />
