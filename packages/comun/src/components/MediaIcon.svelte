<script lang="ts" module>
	export type MediaIconName =
		| 'play'
		| 'pause'
		| 'previous'
		| 'next'
		| 'stop'
		| 'close'
		| 'shuffle'
		| 'repeat'
		| 'single'
		| 'queue'
		| 'volume'
		| 'muted';
</script>

<script lang="ts">
	let { name, class: className = 'h-4 w-4' }: { name: MediaIconName; class?: string } = $props();
</script>

<!-- The player's controls, drawn the same everywhere instead of font glyphs that each system
     renders its own way. -->
<svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true">
	{#if name === 'play'}
		<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
	{:else if name === 'pause'}
		<rect x="6" y="5" width="4" height="14" rx="1" />
		<rect x="14" y="5" width="4" height="14" rx="1" />
	{:else if name === 'previous'}
		<rect x="5" y="5" width="2.5" height="14" rx="1" />
		<path
			d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.6 13.2a1.5 1.5 0 0 1 0-2.4l7.85-5.43A1 1 0 0 1 19 6.2Z"
		/>
	{:else if name === 'next'}
		<rect x="16.5" y="5" width="2.5" height="14" rx="1" />
		<path
			d="M5 6.2v11.6a1 1 0 0 0 1.55.83l7.85-5.43a1.5 1.5 0 0 0 0-2.4L6.55 5.37A1 1 0 0 0 5 6.2Z"
		/>
	{:else if name === 'stop'}
		<rect x="6" y="6" width="12" height="12" rx="2" />
	{:else if name === 'close'}
		<path
			d="M6 6l12 12M18 6 6 18"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
		/>
	{:else if name === 'shuffle'}
		<g
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path
				d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.3 3.4-3M13.1 10c.8-1.7 1.8-3 3.4-3H20"
			/>
			<path d="m17 4 3 3-3 3M17 14l3 3-3 3" />
		</g>
	{:else if name === 'repeat'}
		<g
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M4 11V9a2 2 0 0 1 2-2h13M20 13v2a2 2 0 0 1-2 2H5" />
			<path d="m16 4 3 3-3 3M8 20l-3-3 3-3" />
		</g>
	{:else if name === 'single'}
		<!-- One track, and the stop at its end. -->
		<path
			d="M4 6.2v11.6a1 1 0 0 0 1.55.83l7.85-5.43a1.5 1.5 0 0 0 0-2.4L5.55 5.37A1 1 0 0 0 4 6.2Z"
		/>
		<rect x="15.5" y="5" width="4.5" height="14" rx="1" />
	{:else if name === 'queue'}
		<!-- A list, with what plays now at the top. -->
		<path d="M4 6.5l5 3-5 3Z" />
		<path
			d="M12 9.5h8M4 16.5h16M4 20.5h16"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		/>
	{:else if name === 'volume' || name === 'muted'}
		<!-- A speaker: with its sound, or crossed out. -->
		<path
			d="M3 9.5v5a1 1 0 0 0 1 1h3l4.4 3.7a1 1 0 0 0 1.6-.8V5.6a1 1 0 0 0-1.6-.8L7 8.5H4a1 1 0 0 0-1 1Z"
		/>
		<path
			d={name === 'volume'
				? 'M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12'
				: 'M16 9l5 6M21 9l-5 6'}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		/>
	{/if}
</svg>
