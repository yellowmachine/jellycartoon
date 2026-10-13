<script lang="ts">
	import { musicTarget } from '#lib/music-target.svelte.ts';

	const choice = (selected: boolean) => [
		'px-3 py-1 text-sm',
		selected ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
	];
</script>

<div class="flex items-center gap-2">
	<span class="text-sm text-zinc-400">Sonar en</span>
	<div class="flex overflow-hidden rounded-md border border-zinc-700" role="group">
		<button
			class={choice(musicTarget.value === 'here')}
			aria-pressed={musicTarget.value === 'here'}
			onclick={() => musicTarget.set('here')}>Este dispositivo</button
		>
		<button
			class={choice(musicTarget.value === 'snapcast')}
			aria-pressed={musicTarget.value === 'snapcast'}
			onclick={() => musicTarget.set('snapcast')}>Snapcast</button
		>
	</div>
</div>
{#if musicTarget.error}
	<p class="mt-2 text-sm text-red-400">{musicTarget.error}</p>
{/if}
