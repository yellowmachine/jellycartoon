<script lang="ts">
	import RecipeCard from '#lib/components/RecipeCard.svelte';
	import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { recipe } from '#lib/recipe.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { voiceHint } from '#lib/voice-hint.svelte.ts';

	/**
	 * Voice commands (#33), big: held down, it listens; let go, it is sent. Its answer is shown big
	 * and read aloud. The same as the header's microphone (voice-client.svelte.ts), with room for
	 * the options and for writing instead. In /voz, and in the kitchen panel (`inPanel`), over any
	 * page: a video there goes on playing (#60).
	 */

	let { inPanel = false }: { inPanel?: boolean } = $props();

	/** Written instead of said: to try a sentence, or where there is no microphone. */
	let typed = $state('');

	function release() {
		if (micMode.tap) return;
		if (voice.stop() === 'tap') voice.problem = 'Mantén pulsado el botón mientras hablas.';
	}

	/** «13:42»: in the kitchen's session, when each thing was said. */
	const time = (at: number) =>
		new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

	/** Held down, or (Ajustes) a tap to start and another to send. */
	function press() {
		if (micMode.tap) voice.toggle();
		else void voice.start();
	}
</script>

<div
	class={[
		'flex flex-col items-center text-center',
		inPanel ? 'gap-8 px-4 py-4 md:py-6' : 'min-h-[70vh] justify-center gap-10 py-8'
	]}
>
	<!-- Cooking (#60): the step first; the microphone, smaller, under it. -->
	{#if recipe.current}
		<RecipeCard />
	{/if}

	{#if voice.phase === 'listening' || voice.phase === 'thinking'}
		<p class="text-3xl font-semibold text-zinc-200">
			{voice.phase === 'thinking'
				? 'Un momento…'
				: micMode.tap
					? 'Te escucho… toca para enviar'
					: 'Te escucho…'}
		</p>
	{:else if !voiceHint.closed}
		<!-- Closed once, it stays closed on this device. -->
		<div
			class="flex items-center gap-3 rounded-2xl bg-zinc-900 py-3 pr-2 pl-6 text-3xl font-semibold text-zinc-200"
		>
			{micMode.tap ? 'Toca y habla' : 'Mantén pulsado y habla'}
			<button
				class="rounded-full p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
				aria-label="Cerrar el aviso"
				onclick={() => voiceHint.close()}
			>
				<svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
					<path
						d="M6 6l12 12M18 6L6 18"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Touch: no selecting text nor the menu of a long press, and no scrolling while it is held. -->
	<button
		class={[
			'flex touch-none items-center justify-center rounded-full shadow-2xl transition duration-150 select-none',
			inPanel ? 'h-24 w-24 md:h-32 md:w-32' : recipe.current ? 'h-40 w-40' : 'h-56 w-56',
			voice.phase === 'listening'
				? 'scale-110 bg-red-500 text-white'
				: 'bg-amber-500 text-zinc-950 active:scale-95',
			voice.phase === 'thinking' && 'opacity-60'
		]}
		aria-label={micMode.tap
			? voice.phase === 'listening'
				? 'Toca para enviar'
				: 'Toca para hablar'
			: 'Mantén pulsado para hablar'}
		disabled={voice.phase === 'thinking'}
		onpointerdown={(e) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			press();
		}}
		onpointerup={release}
		onpointercancel={release}
		oncontextmenu={(e) => e.preventDefault()}
		onkeydown={(e) => {
			if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
				e.preventDefault();
				press();
			}
		}}
		onkeyup={(e) => {
			if (e.key === ' ' || e.key === 'Enter') release();
		}}
	>
		<svg
			viewBox="0 0 24 24"
			class={inPanel ? 'h-12 w-12 md:h-16 md:w-16' : 'h-24 w-24'}
			fill="currentColor"
			aria-hidden="true"
		>
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
		O {micMode.tap ? 'pulsa' : 'mantén'} <kbd class="rounded border border-zinc-700 px-1">Ctrl</kbd>
		+
		<kbd class="rounded border border-zinc-700 px-1">Mayús</kbd> +
		<kbd class="rounded border border-zinc-700 px-1">Espacio</kbd>{micMode.tap
			? ': una vez para empezar y otra para enviar,'
			: ','} en cualquier página.
	</p>

	{#snippet choices()}
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
	{/snippet}

	<!-- In kitchen mode, the answer is the session's first line, below: here only what is pending. -->
	<div class={['max-w-xl text-2xl', !kitchenMode.on && 'min-h-24']} aria-live="polite">
		{#if voice.heard && (!kitchenMode.on || voice.phase !== 'idle')}
			<p class="text-xl text-zinc-400">«{voice.heard}»</p>
		{/if}
		{#if voice.problem}
			<p class="mt-3 text-amber-300">{voice.problem}</p>
		{:else if voice.reply && !kitchenMode.on}
			<p class="mt-3 text-3xl font-semibold">{voice.reply}</p>
		{/if}
		{#if !kitchenMode.on}
			{@render choices()}
		{/if}
	</div>

	<!-- The kitchen's session (#60), the newest first and big: what was said, and when. -->
	{#if kitchenMode.on && kitchenLog.entries.length}
		<ol class="-mt-6 w-full max-w-2xl space-y-4 text-left" aria-label="Lo hablado en la cocina">
			{#each kitchenLog.entries as entry, i (entry.id)}
				<li
					class={i === 0
						? 'rounded-2xl border border-amber-500/40 bg-zinc-900 p-5'
						: 'border-t border-zinc-800 px-5 pt-3'}
				>
					<p class="text-sm text-zinc-500 tabular-nums">
						{time(entry.at)}{entry.said ? '' : ' · 🔔 aviso'}
					</p>
					{#if entry.said}
						<p class={i === 0 ? 'text-xl text-zinc-400' : 'text-base text-zinc-500'}>
							«{entry.said}»
						</p>
					{/if}
					<p class={i === 0 ? 'mt-1 text-2xl font-semibold' : 'text-lg text-zinc-400'}>
						{entry.reply}
					</p>
					{#if i === 0}
						{@render choices()}
					{/if}
				</li>
			{/each}
		</ol>
	{/if}

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
