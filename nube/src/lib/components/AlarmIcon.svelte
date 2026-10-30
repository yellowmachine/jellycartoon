<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/**
	 * An alarm or a timer, drawn as the sections are (comun's SectionIcon): an alarm clock, and a
	 * stopwatch. Ringing, it shakes.
	 */
	let {
		name,
		ringing = false,
		class: className = ''
	}: { name: 'alarma' | 'temporizador'; ringing?: boolean; class?: ClassValue } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={[className, ringing && 'ringing']}
	aria-hidden="true"
>
	{#if name === 'alarma'}
		<circle cx="12" cy="13" r="7.5" />
		<path d="M12 9v4l2.5 2M3.5 5.5l3-2.5M20.5 5.5l-3-2.5M7 19.5l-1.5 2M17 19.5l1.5 2" />
	{:else}
		<circle cx="12" cy="13.5" r="7.5" />
		<path d="M10 2.5h4M12 2.5V6M18.5 6.5l1.5-1.5M12 13.5l3-3" />
	{/if}
</svg>

<style>
	.ringing {
		animation: shake 0.6s ease-in-out infinite;
		transform-origin: 50% 20%;
	}
	@keyframes shake {
		0%,
		100% {
			transform: rotate(0);
		}
		25% {
			transform: rotate(-12deg);
		}
		75% {
			transform: rotate(12deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ringing {
			animation: none;
		}
	}
</style>
