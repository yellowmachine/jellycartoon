<script lang="ts">
	import MediaIcon from './MediaIcon.svelte';

	type Mode = 'shuffle' | 'repeat' | 'single';
	let {
		shuffle,
		repeat,
		single,
		onchange
	}: {
		shuffle: boolean;
		repeat: boolean;
		single: boolean;
		onchange: (mode: Mode, value: boolean) => void;
	} = $props();

	const modes = $derived([
		{ mode: 'shuffle', on: shuffle, label: 'Mezclar' },
		{ mode: 'repeat', on: repeat, label: single ? 'Repetir la canción' : 'Repetir' },
		{ mode: 'single', on: single, label: 'Solo esta canción' }
	] satisfies { mode: Mode; on: boolean; label: string }[]);
</script>

<!-- Toggles, lit while on; the same in the browser's bar and in Snapcast's. -->
{#each modes as { mode, on, label } (mode)}
	<button
		class={[
			'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors',
			on ? 'bg-zinc-800 text-amber-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-white'
		]}
		aria-label={label}
		aria-pressed={on}
		title={label}
		onclick={() => onchange(mode, !on)}><MediaIcon name={mode} /></button
	>
{/each}
