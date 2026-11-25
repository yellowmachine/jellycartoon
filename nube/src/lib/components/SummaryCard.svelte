<!--
@component
The home page's card: the last 7 days in a few words, and the way to Preguntar → Resumen.
-->
<script lang="ts">
	import { euros } from 'comun/expenses.ts';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { sectionOn, type SectionChoices } from '#lib/nav.ts';
	import { section } from '#lib/styles.ts';
	import { cardLines, SUMMARY_BLOCKS } from '#lib/summary.ts';
	import { walkDistanceText } from '#lib/walks.ts';
	import type { summaryOf } from '#lib/server/summary.ts';

	interface Props {
		summary: Promise<Awaited<ReturnType<typeof summaryOf>> | null>;
		sections?: SectionChoices;
		mine?: SectionChoices;
	}
	let { summary, sections, mine }: Props = $props();
</script>

{#await summary then s}
	{@const lines = s
		? cardLines({ ...s, euros, distance: walkDistanceText }).filter((l) =>
				sectionOn(SUMMARY_BLOCKS[l.block].section, sections, mine)
			)
		: []}
	{#if lines.length}
		<a href="/preguntar/resumen" class="{section} block hover:border-amber-500/60">
			<h2 class="mb-2 flex items-baseline justify-between gap-3 font-semibold">
				Tus últimos 7 días
				<span class="text-sm font-normal text-amber-400">Resumen</span>
			</h2>
			<ul class="flex flex-col gap-1">
				{#each lines as l (l.block)}
					<li class="flex items-center gap-3">
						<SectionIcon
							name={l.block === 'dinero' ? 'gastos' : l.block === 'paseos' ? 'paseos' : 'agenda'}
							class="h-5 w-5 shrink-0 text-zinc-400"
						/>
						<span>{l.text}</span>
					</li>
				{/each}
			</ul>
		</a>
	{/if}
{/await}
