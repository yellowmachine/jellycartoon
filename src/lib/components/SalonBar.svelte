<script lang="ts">
	import MediaIcon from './MediaIcon.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { watchSalon } from '#lib/salon.svelte.ts';

	const salon = watchSalon();
	const mpv = $derived(salon.state);
</script>

<!-- Only while something is on screen in the living room, or it could not be opened. -->
{#if mpv?.active}
	<div
		class="flex items-center gap-3 rounded-md border border-zinc-700 bg-zinc-900/80 p-3 backdrop-blur"
	>
		<button
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500 text-zinc-950 transition-colors hover:bg-amber-400"
			aria-label={mpv.paused ? 'Seguir' : 'Pausa'}
			onclick={() => salon.send({ action: 'pause', value: !mpv.paused })}
			><MediaIcon name={mpv.paused ? 'play' : 'pause'} /></button
		>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm">
				En el salón: {mpv.title}{#if mpv.subtitle}<span class="text-zinc-400">
						· {mpv.subtitle}</span
					>{/if}
			</p>
			{#if mpv.intro}
				<p class="text-xs text-zinc-400">Cortinilla de Cine Club…</p>
			{:else if !mpv.live}
				<p class="font-mono text-xs text-zinc-400 tabular-nums">
					{formatDuration(mpv.positionSec) || '0:00'} / {formatDuration(mpv.durationSec)}
				</p>
			{/if}
		</div>
		{#if mpv.intro}
			<button
				class="flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-sm hover:bg-zinc-900"
				onclick={() => salon.send({ action: 'next' })}
				>Saltar <MediaIcon name="next" class="h-3.5 w-3.5" /></button
			>
		{/if}
		<a href="/salon" class="shrink-0 text-sm text-amber-400 hover:underline">Mando →</a>
	</div>
{:else if mpv?.failed}
	<!-- What was sent did not open: without this, the bar would just not be there. -->
	<p class="rounded-md border border-red-900 bg-red-950/80 p-3 text-sm text-red-200 backdrop-blur">
		En el salón: {mpv.failed}
	</p>
{/if}
