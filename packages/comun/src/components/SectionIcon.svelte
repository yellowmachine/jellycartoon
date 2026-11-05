<script lang="ts" module>
	/**
	 * The app's sections, drawn: by their names in the header and its menu, and big in the TV view.
	 * Drawn rather than emoji, which depend on the fonts of the PC in the living room.
	 */
	export type Section =
		| 'series'
		| 'cine'
		| 'canales'
		| 'radio'
		| 'podcasts'
		| 'recetas'
		| 'viajes'
		| 'paseos'
		| 'nevera'
		| 'gastos'
		| 'papeles'
		| 'agenda'
		| 'musica'
		| 'juegos'
		| 'salon'
		| 'infantil'
		| 'oracion'
		| 'gestion';
</script>

<script lang="ts">
	let { name, class: className = '' }: { name: Section; class?: string } = $props();
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
	{#if name === 'series'}
		<rect x="2.5" y="6" width="19" height="13" rx="2" />
		<path d="M8 3l4 3 4-3M10 10.5v5l4.5-2.5z" />
	{:else if name === 'cine'}
		<path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		<path d="M3 10l-.4-3.2a1.5 1.5 0 0 1 1.3-1.7L18 3.3a1.5 1.5 0 0 1 1.7 1.3L20.1 7z" />
		<path d="M7.5 4.6l2.2 3.6M12.7 4l2.2 3.6" />
	{:else if name === 'canales'}
		<circle cx="12" cy="9" r="1.5" />
		<path
			d="M8.5 5.5a5 5 0 0 0 0 7M15.5 5.5a5 5 0 0 1 0 7M5.5 3a9 9 0 0 0 0 12M18.5 3a9 9 0 0 1 0 12"
		/>
		<path d="M12 10.5L8.5 21M12 10.5L15.5 21M9.7 17.5h4.6" />
	{:else if name === 'musica'}
		<path d="M9 18V5.5l11-2.5v12.5" />
		<circle cx="6.5" cy="18" r="2.5" />
		<circle cx="17.5" cy="15.5" r="2.5" />
	{:else if name === 'juegos'}
		<!-- A gamepad. -->
		<path
			d="M6.5 7h11a4 4 0 0 1 4 4v3.5a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.6 2.3a3 3 0 0 1-5.4-1.8V11a4 4 0 0 1 4-4z"
		/>
		<path d="M7.5 9.5v3M6 11h3" />
		<circle cx="15.5" cy="10.5" r="0.5" />
		<circle cx="17.5" cy="12" r="0.5" />
	{:else if name === 'podcasts'}
		<!-- A microphone. -->
		<rect x="9" y="2.5" width="6" height="11" rx="3" />
		<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
	{:else if name === 'recetas'}
		<!-- A pot. -->
		<path d="M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
		<path d="M2 10h20M9 6.5c0-1 .8-1 .8-2M12.5 6.5c0-1 .8-1 .8-2" />
	{:else if name === 'nevera'}
		<!-- A fridge (Lucide's refrigerator). -->
		<path d="M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z" />
		<path d="M5 10h14" />
		<path d="M15 7v6" />
	{:else if name === 'agenda'}
		<!-- A calendar (Lucide's calendar). -->
		<path d="M8 2v4" />
		<path d="M16 2v4" />
		<rect width="18" height="18" x="3" y="4" rx="2" />
		<path d="M3 10h18" />
	{:else if name === 'gastos'}
		<!-- A receipt (Lucide's receipt). -->
		<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
		<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
		<path d="M12 17.5v-11" />
	{:else if name === 'papeles'}
		<!-- A file with a lock would not read at this size: a document (Lucide's file-text). -->
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
		<path d="M14 2v6h6" />
		<path d="M16 13H8" />
		<path d="M16 17H8" />
	{:else if name === 'viajes'}
		<!-- A car. -->
		<path
			d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"
		/>
		<circle cx="7" cy="17" r="2" />
		<path d="M9 17h6" />
		<circle cx="17" cy="17" r="2" />
	{:else if name === 'paseos'}
		<!-- Footprints (Lucide's footprints). -->
		<path
			d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"
		/>
		<path
			d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"
		/>
		<path d="M16 17h4" />
		<path d="M4 13h4" />
	{:else if name === 'salon'}
		<!-- A sofa. -->
		<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
		<path d="M3 13a2 2 0 0 1 4 0v1h10v-1a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
		<path d="M5.5 19v2M18.5 19v2" />
	{:else if name === 'infantil'}
		<!-- A smiling face. -->
		<circle cx="12" cy="12" r="9" />
		<path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
		<path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.5" />
	{:else if name === 'oracion'}
		<!-- A candle. -->
		<path d="M12 3c1.6 2 2.2 3.1 2.2 4.3a2.2 2.2 0 0 1-4.4 0c0-1.2.6-2.3 2.2-4.3z" />
		<path d="M12 9.5V11" />
		<rect x="9" y="11" width="6" height="9" rx="1" />
		<path d="M6 21h12" />
	{:else if name === 'gestion'}
		<!-- A gear. -->
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
		/>
	{:else}
		<!-- radio -->
		<rect x="2.5" y="8" width="19" height="13" rx="2" />
		<path d="M7 8l11-5" />
		<circle cx="15.5" cy="14.5" r="3" />
		<path d="M6 12.5h4M6 15.5h4" />
	{/if}
</svg>
