<script lang="ts">
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';

	/**
	 * What the header's microphone heard and what the AI answered, under the header, on any page
	 * but /voz (which shows it big): it goes away by itself a while after the answer has been read.
	 */

	/** After the answer has been read, or shown where nothing reads it. */
	const LINGER_MS = 8000;

	const open = $derived(voice.phase !== 'idle' || voice.reply !== null || voice.problem !== null);

	// A question with options waits for one; anything else, once read, goes away.
	$effect(() => {
		if (voice.phase !== 'idle' || voice.speaking || voice.options.length) return;
		if (voice.reply === null && voice.problem === null) return;
		const timer = setTimeout(() => voice.dismiss(), LINGER_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if open}
	<div
		class="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm shadow-lg"
		role="status"
		aria-live="polite"
	>
		<div class="min-w-0 flex-1">
			{#if voice.phase === 'listening'}
				<p class="font-semibold text-red-400">
					Te escucho… {micMode.tap ? 'toca otra vez para enviar' : 'suelta para enviar'}
				</p>
			{:else}
				{#if voice.heard}
					<p class="truncate text-zinc-400">«{voice.heard}»</p>
				{/if}
				{#if voice.phase === 'thinking'}
					<p class="text-zinc-300">Un momento…</p>
				{:else if voice.problem}
					<p class="text-amber-300">{voice.problem}</p>
				{:else if voice.reply}
					<p class="text-base">{voice.reply}</p>
				{/if}
				{#if voice.options.length}
					<!-- What was not clear: a tap on one is the same as saying it. -->
					<div class="mt-2 flex flex-wrap gap-2">
						{#each voice.options as option (option.command)}
							<button
								class="rounded-full bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
								disabled={voice.phase !== 'idle'}
								onclick={() => voice.command(option.command)}>{option.label}</button
							>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
		{#if voice.phase === 'idle'}
			<button
				class="-m-1 rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
				aria-label="Cerrar"
				onclick={() => voice.dismiss()}>✕</button
			>
		{/if}
	</div>
{/if}
