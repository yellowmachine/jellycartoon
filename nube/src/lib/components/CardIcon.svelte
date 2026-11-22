<!--
@component
The home page's cards, drawn with the same line as the sections (SectionIcon) instead of emoji,
which each phone draws its own way. The Buzón's is SectionIcon's, as in the menu.
-->
<script lang="ts" module>
	export type CardIconName =
		'coche' | 'compra' | 'noticias' | 'deberes' | 'aviso' | 'pausa' | 'compania';

	export interface CardIconProps {
		/** Which drawing. */
		name: CardIconName;
		/** Classes for the drawing, its size by default. */
		class?: string;
	}
</script>

<script lang="ts">
	let { name, class: className = 'h-5 w-5' }: CardIconProps = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{#if name === 'coche'}
		<!-- A car seen from the front (Lucide's car-front): Viajes has the one from the side. -->
		<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
		<path d="M7 14h.01" />
		<path d="M17 14h.01" />
		<rect width="18" height="8" x="3" y="10" rx="2" />
		<path d="M5 18v2" />
		<path d="M19 18v2" />
	{:else if name === 'compra'}
		<!-- A trolley (Lucide's shopping-cart). -->
		<circle cx="8" cy="21" r="1" />
		<circle cx="19" cy="21" r="1" />
		<path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
	{:else if name === 'noticias'}
		<!-- A newspaper (Lucide's newspaper). -->
		<path d="M15 18h-5" />
		<path d="M18 14h-8" />
		<path
			d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"
		/>
		<rect width="8" height="4" x="10" y="6" rx="1" />
	{:else if name === 'deberes'}
		<!-- An open book (Lucide's book-open). -->
		<path d="M12 7v14" />
		<path
			d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
		/>
	{:else if name === 'aviso'}
		<!-- A warning (Lucide's triangle-alert). -->
		<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
		<path d="M12 9v4" />
		<path d="M12 17h.01" />
	{:else if name === 'pausa'}
		<!-- Paused (Lucide's circle-pause). -->
		<circle cx="12" cy="12" r="10" />
		<path d="M10 15V9" />
		<path d="M14 15V9" />
	{:else if name === 'compania'}
		<!-- A heart (Lucide's heart): someone looked after. -->
		<path
			d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
		/>
	{/if}
</svg>
