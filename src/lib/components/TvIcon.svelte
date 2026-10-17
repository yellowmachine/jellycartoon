<script lang="ts">
	/** The TV view's sections, drawn: an emoji depends on the fonts of the PC in the living room. */
	let {
		name,
		class: className = ''
	}: { name: 'series' | 'cine' | 'canales' | 'radio' | 'musica'; class?: string } = $props();
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
	{:else}
		<rect x="2.5" y="8" width="19" height="13" rx="2" />
		<path d="M7 8l11-5" />
		<circle cx="15.5" cy="14.5" r="3" />
		<path d="M6 12.5h4M6 15.5h4" />
	{/if}
</svg>
