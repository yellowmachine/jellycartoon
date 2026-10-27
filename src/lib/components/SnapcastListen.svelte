<script lang="ts">
	import { musicTarget, watchSnapcast } from '#lib/music-target.svelte.ts';
	import type { SnapcastWhere } from '#lib/music.ts';

	/**
	 * «Solo el audio, por Snapcast» (#223): an episode's audio, and the ones after it, in the whole
	 * house or only on one speaker, e.g. to fall asleep with a series in the bedroom. As the menus'
	 * other rows, in the player's and in the episode's «⋯».
	 */
	interface Props {
		episodeId: number;
		/** From this second, as it is now; null, from where it was left. */
		startSec: () => number | null;
		/** Each row's class, as the menu's others. */
		itemClass: string;
		/** It sounds there now: e.g. the video here stops. */
		onsent?: () => void;
	}

	let { episodeId, startSec, itemClass, onsent }: Props = $props();

	const snapcast = watchSnapcast();
	const speakers = $derived((snapcast.state?.speakers ?? []).filter((s) => s.connected));
	let sending = $state(false);

	async function send(where: SnapcastWhere) {
		sending = true;
		await musicTarget.send({ action: 'episode', episodeId, startSec: startSec(), where });
		sending = false;
		if (!musicTarget.error) onsent?.();
	}
</script>

<p class="px-3 pt-2 pb-1 text-xs text-zinc-500">🔈 Solo el audio, por Snapcast</p>
<button type="button" class={itemClass} disabled={sending} onclick={() => send('house')}
	>Toda la casa</button
>
{#if speakers.length > 1}
	{#each speakers as s (s.id)}
		<button
			type="button"
			class={itemClass}
			disabled={sending}
			onclick={() => send({ speakerId: s.id })}>Solo en {s.name}</button
		>
	{/each}
{/if}
{#if musicTarget.error}
	<p class="px-3 pb-1 text-xs text-red-400">{musicTarget.error}</p>
{/if}
