<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { recipe } from '#lib/recipe.svelte.ts';
	import { formatLeft } from '#lib/timer-names.ts';
	import { timers } from '#lib/timers.svelte.ts';

	/**
	 * The kitchen timers (#60), in the header: each counting down, with an × to take it away; one
	 * that ended, big, with «Parar»; the prepared ones, waiting, after them.
	 */

	onMount(() => {
		// Before the timers: one that ended while the page was closed moves the recipe on, and is
		// written in the kitchen's session.
		recipe.load();
		kitchenLog.load();
		// Kitchen mode before the timers too: whether what rings now is kept in its session.
		kitchenMode.load();
		timers.load();
		// After a reload, sound needs a touch on the page first: any will do.
		const unlock = () => timers.unlockSound();
		addEventListener('pointerdown', unlock, { once: true });
		return () => removeEventListener('pointerdown', unlock);
	});
</script>

{#if timers.ringing.length}
	<div
		class="flex items-center gap-3 rounded-md border border-amber-500 bg-amber-500/15 p-3"
		role="alert"
	>
		<span class="text-2xl motion-safe:animate-bounce" aria-hidden="true">⏰</span>
		<p class="min-w-0 flex-1 text-lg font-semibold text-amber-300">
			Ya está: {timers.ringing.map((t) => t.label).join(', ')}
		</p>
		<button
			class="shrink-0 rounded-md bg-amber-500 px-5 py-2.5 text-base font-semibold text-zinc-950 hover:bg-amber-400"
			onclick={() => timers.silence()}>Parar</button
		>
	</div>
{/if}
{#if timers.list.length || timers.prepared.length || kitchenMode.on || recipe.current}
	<div class="flex flex-wrap gap-2" aria-label="Temporizadores">
		{#if recipe.current && page.url.pathname !== '/voz'}
			<!-- The recipe being cooked: its step, big, is in /voz. -->
			<a
				href="/voz"
				class="flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-sm text-amber-300 hover:bg-amber-500/20"
			>
				<span class="max-w-48 truncate">🍳 {recipe.current.title}</span>
				<span class="text-amber-300/70"
					>paso {recipe.step + 1} de {recipe.current.steps.length}</span
				>
			</a>
		{/if}
		{#if kitchenMode.on}
			<!-- On every page, to see it is on and turn it off. -->
			<span
				class="flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/10 py-1 pr-1 pl-3 text-sm text-amber-300"
				title={kitchenMode.problem ?? 'La pantalla no se apaga'}
			>
				🍳 Modo cocina{kitchenMode.problem ? ' (sin pantalla encendida)' : ''}
				<button
					class="flex h-6 w-6 items-center justify-center rounded-full text-amber-300/70 hover:bg-zinc-800 hover:text-white"
					aria-label="Quitar el modo cocina"
					onclick={() => kitchenMode.set(false)}>×</button
				>
			</span>
		{/if}
		{#each timers.list.toSorted((a, b) => a.endsAt - b.endsAt) as timer (timer.id)}
			<span
				class="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 py-1 pr-1 pl-3 text-sm"
			>
				<span aria-hidden="true">⏱</span>
				<span class="max-w-40 truncate">{timer.label}</span>
				<span class="font-mono text-amber-400 tabular-nums"
					>{formatLeft((timer.endsAt - timers.now) / 1000)}</span
				>
				<button
					class="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white"
					aria-label="Quitar el temporizador {timer.label}"
					onclick={() => timers.cancel(timer.label)}>×</button
				>
			</span>
		{/each}
		<!-- Prepared, waiting for «ya hierve»: grey, and a tap starts it (wet hands, no voice). -->
		{#each timers.prepared as timer (timer.id)}
			<span
				class="flex items-center gap-1 rounded-full border border-dashed border-zinc-700 py-1 pr-1 pl-1 text-sm text-zinc-400"
			>
				<button
					class="flex items-center gap-2 rounded-full px-2 hover:bg-zinc-800 hover:text-white"
					title="Arrancarlo ya"
					aria-label="Arrancar el temporizador {timer.label}: {formatLeft(timer.seconds)}"
					onclick={() => timers.startPrepared(timer.id)}
				>
					<span aria-hidden="true">▶︎</span>
					<span class="max-w-32 truncate">{timer.label}</span>
					<span class="font-mono tabular-nums">{formatLeft(timer.seconds)}</span>
					<span class="max-w-40 truncate text-xs text-zinc-500">cuando {timer.trigger}</span>
				</button>
				<button
					class="flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-800 hover:text-white"
					aria-label="Quitar el temporizador preparado {timer.label}"
					onclick={() => timers.cancel(timer.label)}>×</button
				>
			</span>
		{/each}
	</div>
{/if}
