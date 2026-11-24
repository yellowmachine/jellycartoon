<script lang="ts">
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { WAKE_WORDS } from 'comun/wake-words.ts';

	/**
	 * The round microphone (Hablar, the Vista and Carretera): held, or (Ajustes) a tap to start and
	 * another to send; red while it listens, dim while it thinks. While it waits for the wake word,
	 * a halo around it that breathes, slowly (#525), to see from across the room that it is
	 * listening; `still`, the halo without moving (Carretera: nothing that beats in the driver's
	 * eye), and so too for whoever asked their device for less motion. When the browser needs a
	 * touch before it lets the microphone start, a dashed ring: touch me.
	 */
	let {
		class: size,
		iconClass,
		press,
		release,
		still = false
	}: {
		/** Its size, as Tailwind classes. */
		class: string;
		iconClass: string;
		press: () => void;
		release: () => void;
		still?: boolean;
	} = $props();

	/** Listening for the word, and nothing else going on. */
	const waiting = $derived(wakeWord.status === 'on' && voice.phase === 'idle' && !voice.speaking);
	const needsTap = $derived(wakeWord.status === 'tap' && voice.phase === 'idle');
	const word = $derived(WAKE_WORDS[wakeWord.word]);
</script>

<!-- Touch: no selecting text nor the menu of a long press, and no scrolling while it is held. -->
<button
	class={[
		'relative isolate flex shrink-0 touch-none items-center justify-center rounded-full shadow-2xl transition duration-150 select-none',
		size,
		voice.phase === 'listening'
			? 'scale-110 bg-red-500 text-claro'
			: 'bg-amber-500 text-zinc-950 active:scale-95',
		voice.phase === 'thinking' && 'opacity-60'
	]}
	aria-label={micMode.tap
		? voice.phase === 'listening'
			? 'Toca para enviar'
			: 'Toca para hablar'
		: 'Mantén pulsado para hablar'}
	title={waiting
		? `Esperando «${word}»`
		: needsTap
			? `Toca la pantalla para que espere «${word}»`
			: undefined}
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
	<!-- Behind the button, wider than it: only its opacity moves (cheap, on all day). -->
	<span class={['halo', waiting && 'on', still && 'still']} aria-hidden="true"></span>
	{#if needsTap}
		<span
			class="pointer-events-none absolute -inset-2.5 -z-10 rounded-full border-[3px] border-dashed border-amber-300/80"
			aria-hidden="true"
		></span>
	{/if}
	<svg viewBox="0 0 24 24" class={iconClass} fill="currentColor" aria-hidden="true">
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

<style>
	.halo {
		position: absolute;
		inset: -30%;
		z-index: -1;
		border-radius: 9999px;
		pointer-events: none;
		/* From the button's edge (62 % of the halo's radius) outwards, fading; clear inside, where it
		   would tint the button (it is painted over its background). */
		background: radial-gradient(
			circle closest-side,
			transparent 60%,
			rgb(251 191 36 / 0.9) 61%,
			rgb(251 191 36 / 0.35) 80%,
			transparent 100%
		);
		opacity: 0;
		transition: opacity 600ms ease-out;
	}
	.halo.on {
		animation: breathe 4s ease-in-out infinite;
	}
	.halo.on.still {
		animation: none;
		opacity: 0.55;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 0.9;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.halo.on {
			animation: none;
			opacity: 0.55;
		}
	}
</style>
