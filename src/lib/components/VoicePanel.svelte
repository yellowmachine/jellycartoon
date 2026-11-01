<script lang="ts">
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { tapMic } from '#lib/mic-tap.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import WakeWordMeters from '#lib/components/WakeWordMeters.svelte';
	import { voiceHint } from '#lib/voice-hint.svelte.ts';

	/**
	 * Voice commands (#33), big: held down, it listens; let go, it is sent. Its answer is shown big
	 * and read aloud. The same as the header's microphone (voice-client.svelte.ts), with room for
	 * the options and for writing instead. In /voz.
	 */

	/** Written instead of said: to try a sentence, or where there is no microphone. */
	let typed = $state('');

	function release() {
		if (micMode.tap) return;
		if (voice.stop() === 'tap') voice.problem = 'Mantén pulsado el botón mientras hablas.';
	}

	/** Held down, or (Ajustes) a tap to start and another to send. */
	function press() {
		if (micMode.tap) tapMic();
		else void voice.start();
	}
</script>

<div class="flex min-h-[70vh] flex-col items-center justify-center gap-10 py-8 text-center">
	{#if voice.phase === 'listening' || voice.phase === 'thinking'}
		<p class="text-3xl font-semibold text-zinc-200">
			{voice.phase === 'thinking'
				? 'Un momento…'
				: wakeWord.preparing
					? 'Preparando el micrófono…'
					: voice.handsFree
						? 'Te escucho… se envía al callarte'
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
			'h-56 w-56',
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
		O {micMode.tap ? 'pulsa' : 'mantén'} <kbd class="rounded border border-zinc-700 px-1">Ctrl</kbd>
		+
		<kbd class="rounded border border-zinc-700 px-1">Mayús</kbd> +
		<kbd class="rounded border border-zinc-700 px-1">Espacio</kbd>{micMode.auto
			? ': una vez y habla, se envía al callarte,'
			: micMode.tap
				? ': una vez para empezar y otra para enviar,'
				: ','} en cualquier página.
	</p>

	<!-- «Avanzado» (Ajustes): how «hola casita» hears here, to try it where it is used. -->
	{#if wakeWord.advanced && wakeWord.on}
		<WakeWordMeters />
	{/if}

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

	<div class="min-h-24 max-w-xl text-2xl" aria-live="polite">
		{#if voice.heard}
			<p class="text-xl text-zinc-400">«{voice.heard}»</p>
		{/if}
		{#if voice.problem}
			<p class="mt-3 text-amber-300">{voice.problem}</p>
		{:else if voice.reply}
			<p class="mt-3 text-3xl font-semibold">{voice.reply}</p>
		{/if}
		{@render choices()}
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
</div>
