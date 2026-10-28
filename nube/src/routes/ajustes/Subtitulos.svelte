<script lang="ts">
	import SubtitleStylePanel from 'comun/components/SubtitleStylePanel.svelte';
	import type { SubtitleStyle } from 'comun/subtitle-style.ts';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/** Cómo se ven tus subtítulos (#253), como en jellycartoon: en Canales, y luego en Series. */
	let { data }: { data: PageData } = $props();

	// Changed here at once; several quick clicks become one save, as at home.
	let subtitleStyle = $derived(data.subtitleStyle);
	let styleTimer: ReturnType<typeof setTimeout> | undefined;
	let styleProblem = $state(false);
	function chooseSubtitleStyle(style: SubtitleStyle) {
		subtitleStyle = style;
		clearTimeout(styleTimer);
		styleTimer = setTimeout(async () => {
			const res = await fetch('/api/subtitulos', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subtitleStyle: style })
			}).catch(() => null);
			styleProblem = !res?.ok;
		}, 400);
	}
</script>

<section class={section} id="subtitulos">
	<h2 class="mb-1 font-semibold">Subtítulos</h2>
	<p class="text-sm text-zinc-400">
		Cómo se ven en los canales. Los de casa tienen los suyos, en sus Ajustes.
	</p>
	<SubtitleStylePanel style={subtitleStyle} onchange={chooseSubtitleStyle} />
	{#if styleProblem}
		<p class="mt-2 text-sm text-red-400">No se pudo guardar el estilo.</p>
	{/if}
</section>
