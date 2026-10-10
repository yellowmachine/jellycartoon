<script lang="ts">
	import { formatDuration } from '#lib/format.ts';
	import { watchSalon } from '#lib/salon.svelte.ts';

	const salon = watchSalon();
	const mpv = $derived(salon.state);
</script>

<!-- Only while something is on screen in the living room. -->
{#if mpv?.active}
	<div
		class="sticky bottom-0 z-10 mt-6 flex items-center gap-3 rounded-t-md border border-zinc-700 bg-zinc-950/95 p-3 backdrop-blur"
	>
		<button
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950 hover:bg-amber-400"
			aria-label={mpv.paused ? 'Seguir' : 'Pausa'}
			onclick={() => salon.send({ action: 'pause', value: !mpv.paused })}
			>{mpv.paused ? '▶\uFE0E' : '❚❚'}</button
		>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm">En el salón: {mpv.title}</p>
			<p class="font-mono text-xs text-zinc-400 tabular-nums">
				{formatDuration(mpv.positionSec) || '0:00'} / {formatDuration(mpv.durationSec)}
			</p>
		</div>
		<a href="/salon" class="shrink-0 text-sm text-amber-400 hover:underline">Mando →</a>
	</div>
{/if}
