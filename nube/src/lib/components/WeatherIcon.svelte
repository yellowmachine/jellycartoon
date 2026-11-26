<!--
@component
The sky by its WMO code, with the same line as the sections (SectionIcon) instead of emoji, which
each phone draws its own way: the same groups as `skyIcon`, from Lucide.
-->
<script lang="ts">
	let {
		code,
		label,
		class: className = 'h-5 w-5'
	}: {
		/** Open-Meteo's `weather_code`. */
		code: number;
		/** What it means, said to screen readers; without it, only a drawing. */
		label?: string;
		class?: string;
	} = $props();

	const kind = $derived(
		code === 0 || code === 1
			? 'sol'
			: code === 2
				? 'claros'
				: code === 3
					? 'nubes'
					: code === 45 || code === 48
						? 'niebla'
						: (code >= 71 && code <= 77) || code === 85 || code === 86
							? 'nieve'
							: code >= 95
								? 'tormenta'
								: 'lluvia'
	);
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={['inline-block shrink-0', className]}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#if kind === 'sol'}
		<!-- Lucide's sun. -->
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2" />
		<path d="M12 20v2" />
		<path d="m4.93 4.93 1.41 1.41" />
		<path d="m17.66 17.66 1.41 1.41" />
		<path d="M2 12h2" />
		<path d="M20 12h2" />
		<path d="m6.34 17.66-1.41 1.41" />
		<path d="m19.07 4.93-1.41 1.41" />
	{:else if kind === 'claros'}
		<!-- Lucide's cloud-sun. -->
		<path d="M12 2v2" />
		<path d="m4.93 4.93 1.41 1.41" />
		<path d="M20 12h2" />
		<path d="m19.07 4.93-1.41 1.41" />
		<path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
		<path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
	{:else if kind === 'nubes'}
		<!-- Lucide's cloud. -->
		<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
	{:else if kind === 'niebla'}
		<!-- Lucide's cloud-fog. -->
		<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
		<path d="M16 17H7" />
		<path d="M17 21H9" />
	{:else if kind === 'nieve'}
		<!-- Lucide's cloud-snow. -->
		<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
		<path d="M8 15h.01" />
		<path d="M8 19h.01" />
		<path d="M12 17h.01" />
		<path d="M12 21h.01" />
		<path d="M16 15h.01" />
		<path d="M16 19h.01" />
	{:else if kind === 'tormenta'}
		<!-- Lucide's cloud-lightning. -->
		<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
		<path d="m13 12-3 5h4l-3 5" />
	{:else}
		<!-- Lucide's cloud-rain. -->
		<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
		<path d="M16 14v6" />
		<path d="M8 14v6" />
		<path d="M12 16v6" />
	{/if}
</svg>
