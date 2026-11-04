<script lang="ts">
	import { lineAt, type Lyrics } from '../lyrics.ts';

	/**
	 * A song's lyrics: with times, the line being sung lit and kept in the middle, as it goes; without,
	 * all of it to read. `big`, /tv's, from the sofa.
	 */
	let {
		lyrics,
		positionSec,
		big = false,
		class: className = ''
	}: { lyrics: Lyrics; positionSec: number; big?: boolean; class?: string } = $props();

	const now = $derived(lyrics.kind === 'synced' ? lineAt(lyrics.lines, positionSec) : -1);
	let box = $state<HTMLElement>();

	// The line sung, to the middle of its box (not the page's: the bar is at the bottom).
	$effect(() => {
		const line = box?.querySelector<HTMLElement>(`[data-line="${now}"]`);
		if (!box || !line) return;
		box.scrollTo({
			top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
			behavior: 'smooth'
		});
	});
</script>

<div
	bind:this={box}
	class={['relative overflow-y-auto', big ? 'text-4xl leading-snug' : 'text-base', className]}
	aria-label="Letra"
>
	{#if lyrics.kind === 'instrumental'}
		<p class="text-zinc-500 italic">Instrumental</p>
	{:else}
		{#each lyrics.lines as line, i (i)}
			<p
				data-line={i}
				class={[
					'transition-colors duration-300',
					big ? 'py-1' : 'py-0.5',
					!line.text && (big ? 'h-6' : 'h-3'),
					lyrics.kind === 'plain'
						? 'text-zinc-200'
						: i === now
							? 'font-semibold text-white'
							: i < now
								? 'text-zinc-500'
								: 'text-zinc-400'
				]}
			>
				{line.text}
			</p>
		{/each}
	{/if}
</div>
