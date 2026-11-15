<script lang="ts">
	import BarsBlock from '#lib/components/BarsBlock.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import type { Report } from '#lib/reports.ts';
	import AgendaBlock from './AgendaBlock.svelte';
	import ExpensesBlock from './ExpensesBlock.svelte';
	import MovesList from './MovesList.svelte';
	import PhotosBlock from './PhotosBlock.svelte';
	import StatsBlock from './StatsBlock.svelte';
	import WeatherBlock from './WeatherBlock.svelte';

	/** A report's pieces (#505): the AI's words, then each block drawn by Seilide. */
	let { report }: { report: Report } = $props();

	/**
	 * Where each block's data lives, to check it there. Those pages show the data as it is now, not
	 * as the report kept it (expenses taken away, changed since).
	 */
	const days = $derived(new URLSearchParams({ desde: report.from, hasta: report.to }).toString());
	const monthEnd = (m: string) => {
		const [y, mo] = m.split('-').map(Number);
		return `${m}-${String(new Date(Date.UTC(y!, mo!, 0)).getUTCDate()).padStart(2, '0')}`;
	};
	function sources(p: Report['pieces'][number]): { href: string; text: string; out?: true }[] {
		switch (p.block?.kind) {
			case 'cifras':
				return [
					{ href: '/viajes/hechos', text: 'Trayectos' },
					{ href: '/paseos', text: 'Paseos' },
					{ href: `/gastos/busqueda?${days}`, text: 'Gastos de esos días' }
				];
			case 'mapa':
				return [
					{ href: '/viajes/hechos', text: 'Trayectos' },
					{ href: '/paseos', text: 'Paseos' }
				];
			case 'gastos':
				return [{ href: `/gastos/busqueda?${days}`, text: 'Gastos de esos días' }];
			case 'barras': {
				const { labels } = p.block;
				const q = new URLSearchParams({
					desde: `${labels[0]}-01`,
					hasta: monthEnd(labels[labels.length - 1]!)
				});
				return [{ href: `/gastos/busqueda?${q}`, text: 'Gastos de esos meses' }];
			}
			case 'agenda':
				return [{ href: `/agenda?dia=${report.from}`, text: 'Agenda' }];
			case 'tiempo':
				return [{ href: 'https://open-meteo.com/', text: 'Open-Meteo', out: true }];
			default:
				return [];
		}
	}
</script>

<div class="flex flex-col gap-5">
	{#each report.pieces as p, i (i)}
		<section class="flex flex-col gap-2">
			{#if p.text}<p class="whitespace-pre-line text-zinc-200">{p.text}</p>{/if}
			{#if p.block?.kind === 'cifras'}
				<StatsBlock block={p.block} excluded={report.excluded} />
			{:else if p.block?.kind === 'mapa'}
				<TripMap pieces={p.block.ways} photos={p.block.photos} ends={false} />
				{#if p.block.moves?.length}<MovesList moves={p.block.moves} />{/if}
			{:else if p.block?.kind === 'fotos'}
				<PhotosBlock block={p.block} />
			{:else if p.block?.kind === 'gastos'}
				<ExpensesBlock
					block={p.block}
					excluded={report.excluded}
					from={report.from}
					to={report.to}
				/>
			{:else if p.block?.kind === 'barras'}
				<BarsBlock block={p.block} />
			{:else if p.block?.kind === 'agenda'}
				<AgendaBlock block={p.block} />
			{:else if p.block?.kind === 'tiempo'}
				<WeatherBlock block={p.block} />
			{/if}
			{#if sources(p).length}
				<p class="text-right text-xs text-zinc-500">
					Ver en
					{#each sources(p) as l, j (l.href)}{#if j}
							·
						{/if}<a
							href={l.href}
							class="text-zinc-400 underline-offset-2 hover:text-white hover:underline"
							target={l.out ? '_blank' : undefined}
							rel={l.out ? 'noopener' : undefined}>{l.text}{l.out ? ' ↗' : ' →'}</a
						>{/each}
				</p>
			{/if}
			{#if !p.block && p.kind && p.empty}
				<p class="rounded-lg border border-dashed border-zinc-800 p-3 text-sm text-zinc-500">
					{p.empty}
				</p>
			{/if}
		</section>
	{/each}
</div>
