<script lang="ts">
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';

	/**
	 * Voice commands (#33), big: held down, it listens; let go, it is sent. Its answer is shown big
	 * and read aloud. The same as the header's microphone (voice-client.svelte.ts), with room for
	 * the options and for writing instead.
	 */

	/** Written instead of said: to try a sentence, or where there is no microphone. */
	let typed = $state('');

	function release() {
		if (voice.stop() === 'tap') voice.problem = 'Mantén pulsado el botón mientras hablas.';
	}
</script>

<svelte:head>
	<title>Hablar · JellyCartoon</title>
</svelte:head>

<div class="flex min-h-[70vh] flex-col items-center justify-center gap-10 py-8 text-center">
	<p class="text-3xl font-semibold text-zinc-200">
		{voice.phase === 'listening'
			? 'Te escucho…'
			: voice.phase === 'thinking'
				? 'Un momento…'
				: 'Mantén pulsado y habla'}
	</p>

	<!-- Touch: no selecting text nor the menu of a long press, and no scrolling while it is held. -->
	<button
		class={[
			'flex h-56 w-56 touch-none items-center justify-center rounded-full shadow-2xl transition duration-150 select-none',
			voice.phase === 'listening'
				? 'scale-110 bg-red-500 text-white'
				: 'bg-amber-500 text-zinc-950 active:scale-95',
			voice.phase === 'thinking' && 'opacity-60'
		]}
		aria-label="Mantén pulsado para hablar"
		disabled={voice.phase === 'thinking'}
		onpointerdown={(e) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			void voice.start();
		}}
		onpointerup={release}
		onpointercancel={release}
		oncontextmenu={(e) => e.preventDefault()}
		onkeydown={(e) => {
			if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
				e.preventDefault();
				void voice.start();
			}
		}}
		onkeyup={(e) => {
			if (e.key === ' ' || e.key === 'Enter') release();
		}}
	>
		<svg viewBox="0 0 24 24" class="h-24 w-24" fill="currentColor" aria-hidden="true">
			<rect x="9" y="2.5" width="6" height="12" rx="3" />
			<path
				d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>
	</button>

	<!-- With a mouse, a keyboard is likely: the shortcut, from any page. -->
	<p class="-mt-6 hidden text-sm text-zinc-500 pointer-fine:block">
		O mantén <kbd class="rounded border border-zinc-700 px-1">Ctrl</kbd> +
		<kbd class="rounded border border-zinc-700 px-1">Mayús</kbd> +
		<kbd class="rounded border border-zinc-700 px-1">Espacio</kbd>, en cualquier página.
	</p>

	<div class="min-h-24 max-w-xl text-2xl" aria-live="polite">
		{#if voice.heard}
			<p class="text-xl text-zinc-400">«{voice.heard}»</p>
		{/if}
		{#if voice.problem}
			<p class="mt-3 text-amber-300">{voice.problem}</p>
		{:else if voice.reply}
			<p class="mt-3 text-3xl font-semibold">{voice.reply}</p>
		{/if}
		{#if voice.options.length}
			<!-- What was not clear: a tap on one is the same as saying it. -->
			<div class="mt-6 flex flex-col gap-3">
				{#each voice.options as option (option.command)}
					<button
						class="rounded-2xl bg-zinc-800 px-6 py-4 text-2xl font-semibold transition hover:bg-zinc-700 active:scale-95"
						disabled={voice.phase !== 'idle'}
						onclick={() => voice.command(option.command)}>{option.label}</button
					>
				{/each}
			</div>
		{/if}
	</div>

	<form
		class="flex w-full max-w-xl gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			if (!typed.trim() || voice.phase !== 'idle') return;
			void voice.command(typed.trim());
			typed = '';
		}}
	>
		<input
			bind:value={typed}
			placeholder="O escríbelo aquí"
			aria-label="Escribir la orden"
			class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-base"
		/>
		<button
			class="rounded-md bg-zinc-800 px-4 py-2 text-base hover:bg-zinc-700"
			disabled={voice.phase !== 'idle'}>Enviar</button
		>
	</form>

	<!-- The phone on the kitchen wall: the screen stays on, to see the timers and press here. -->
	<div class="flex flex-col items-center gap-1">
		<button
			class={[
				'rounded-full border px-4 py-2 text-base',
				kitchenMode.on
					? 'border-amber-500 bg-amber-500/15 text-amber-300'
					: 'border-zinc-700 text-zinc-300 hover:bg-zinc-900'
			]}
			aria-pressed={kitchenMode.on}
			onclick={() => kitchenMode.set(!kitchenMode.on)}
			>🍳 Modo cocina{kitchenMode.on ? ': pantalla siempre encendida' : ''}</button
		>
		{#if kitchenMode.problem}
			<p class="text-sm text-amber-400">{kitchenMode.problem}</p>
		{:else if !kitchenMode.on}
			<p class="text-xs text-zinc-500">Para el móvil en la cocina: la pantalla no se apaga.</p>
		{/if}
	</div>
</div>
