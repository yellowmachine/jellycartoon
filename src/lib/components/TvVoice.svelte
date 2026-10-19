<script lang="ts">
	import { tick } from 'svelte';
	import { voice } from '#lib/voice-client.svelte.ts';

	/**
	 * Voice in the TV view (#33): the remote's microphone key (F9, remapped by udev, see the README)
	 * starts and sends, and here, big, what it heard and what the AI answered. A question's options
	 * get the remote's focus. It goes away by itself, as the header's bubble does.
	 */

	/** After the answer has been read, or shown where nothing reads it. */
	const LINGER_MS = 8000;

	const open = $derived(voice.phase !== 'idle' || voice.reply !== null || voice.problem !== null);
	let choices = $state<HTMLElement>();

	$effect(() => {
		if (voice.phase !== 'idle' || voice.speaking || voice.options.length) return;
		if (voice.reply === null && voice.problem === null) return;
		const timer = setTimeout(() => voice.dismiss(), LINGER_MS);
		return () => clearTimeout(timer);
	});

	// A question: the remote's focus on its first answer, to choose with the arrows and OK.
	$effect(() => {
		if (!voice.options.length) return;
		void tick().then(() => choices?.querySelector('button')?.focus());
	});
</script>

{#if open}
	<div
		class="fixed inset-x-12 bottom-24 z-30 mx-auto max-w-4xl rounded-3xl border border-white/10 bg-zinc-900/95 p-8 text-center shadow-2xl backdrop-blur"
		role="status"
		aria-live="polite"
	>
		{#if voice.phase === 'listening'}
			<p class="flex items-center justify-center gap-4 text-4xl font-semibold text-red-400">
				<span class="h-5 w-5 animate-pulse rounded-full bg-red-500"></span>
				Te escucho… pulsa el micrófono para enviar
			</p>
		{:else}
			{#if voice.heard}
				<p class="text-2xl text-zinc-400">«{voice.heard}»</p>
			{/if}
			{#if voice.phase === 'thinking'}
				<p class="mt-2 text-3xl text-zinc-300">Un momento…</p>
			{:else if voice.problem}
				<p class="mt-2 text-3xl text-amber-300">{voice.problem}</p>
			{:else if voice.reply}
				<p class="mt-2 text-4xl font-semibold">{voice.reply}</p>
			{/if}
			{#if voice.options.length}
				<div bind:this={choices} class="mt-6 flex flex-wrap justify-center gap-4">
					{#each voice.options as option (option.command)}
						<button
							class="rounded-full bg-zinc-800 px-8 py-4 text-2xl font-semibold transition duration-150 focus-visible:scale-110 focus-visible:bg-amber-500 focus-visible:text-zinc-950"
							disabled={voice.phase !== 'idle'}
							onclick={() => voice.command(option.command)}>{option.label}</button
						>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
{/if}
