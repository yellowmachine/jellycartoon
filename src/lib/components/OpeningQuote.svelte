<!--
  The title card when the app opens: a line from the library on a black screen, as Frasier's between
  scenes. It covers the page while it loads, and goes after a few seconds, or with any key, click or
  touch (which does nothing else: not a step in /tv).
-->
<script lang="ts">
	import '@fontsource/fraunces/500.css';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { wordCount, type OpeningQuote } from '#lib/quotes.ts';

	let { quote, ondone }: { quote: OpeningQuote; ondone: () => void } = $props();

	/** Time to read it, slowly: as in the series, it is not rushed. */
	const ms = () => Math.min(7_000, 3_000 + 250 * wordCount(quote.text));

	onMount(() => {
		const timer = setTimeout(ondone, ms());
		function skip(e: KeyboardEvent) {
			e.preventDefault();
			e.stopImmediatePropagation();
			ondone();
		}
		window.addEventListener('keydown', skip, { capture: true });
		return () => {
			clearTimeout(timer);
			window.removeEventListener('keydown', skip, { capture: true });
		};
	});
</script>

<button
	class="fixed inset-0 z-[100] flex cursor-default flex-col items-center justify-center bg-black px-6 text-center text-white"
	onclick={ondone}
	out:fade={{ duration: 600 }}
>
	<span
		class="quote block max-w-[24ch] text-[clamp(1.75rem,4.5vw,3.5rem)] leading-snug text-balance"
		>{quote.text}</span
	>
	<span class="quote-from mt-10 block text-sm tracking-widest text-zinc-500 uppercase"
		>{quote.series} · T{quote.season} E{quote.number}</span
	>
</button>

<style>
	.quote {
		font-family: 'Fraunces', serif;
		font-weight: 500;
		animation: appear 0.8s ease-out both;
	}
	.quote-from {
		animation: appear 0.8s ease-out 0.6s both;
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.quote,
		.quote-from {
			animation: none;
		}
	}
</style>
