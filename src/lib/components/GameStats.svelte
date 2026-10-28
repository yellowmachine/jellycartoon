<script lang="ts">
	import { formatPlayed } from 'comun/format.ts';

	/**
	 * A person's play statistics (#176), as playStats (game-sessions.ts) gives them: in the TV view,
	 * with links to each game's page; in the whole app, the same without them. Sizes relative to
	 * the page's text, bigger in the TV view.
	 */
	type Stats = {
		week: number;
		month: number;
		total: number;
		games: {
			title: string;
			system: string;
			href: string;
			seconds: number;
			first: string | null;
			last: string | null;
		}[];
		sessions: {
			id: number;
			title: string;
			system: string;
			startedAt: string;
			endedAt: string;
			seconds: number;
		}[];
	};
	let { stats, links = false }: { stats: Stats; links?: boolean } = $props();

	const played = formatPlayed;
	const day = (iso: string) =>
		new Date(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
	const shortDay = (iso: string) =>
		new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
	const hour = (iso: string) =>
		new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
</script>

{#if !stats.games.length}
	<p class="text-zinc-400">
		Todavía no hay partidas contadas. Se cuentan las jugadas a partir de ahora, si tienes activado
		«Guardar historial» en Ajustes.
	</p>
{:else}
	<div class="mb-[1.5em] grid grid-cols-3 gap-[0.75em]">
		{#each [{ label: 'Esta semana', seconds: stats.week }, { label: 'Este mes', seconds: stats.month }, { label: 'En total', seconds: stats.total }] as t (t.label)}
			<div class="rounded-xl border border-white/10 bg-zinc-900 p-[0.75em]">
				<p class="text-[0.8em] text-zinc-400">{t.label}</p>
				<p class="text-[1.6em] font-semibold">{played(t.seconds)}</p>
			</div>
		{/each}
	</div>

	<h2 class="mb-[0.5em] text-[1.25em] font-semibold">Por juego</h2>
	<ul class="mb-[1.5em] divide-y divide-white/10 rounded-xl border border-white/10 bg-zinc-900">
		{#each stats.games as g (g.href)}
			<li>
				<svelte:element
					this={links ? 'a' : 'div'}
					href={links ? g.href : undefined}
					class="flex items-baseline justify-between gap-[1em] px-[0.75em] py-[0.5em] focus-visible:bg-zinc-800"
				>
					<span class="min-w-0">
						<span class="block truncate font-semibold">{g.title}</span>
						<span class="block text-[0.8em] text-zinc-400">
							{g.system}{#if g.first && g.last}
								· desde el {shortDay(g.first)} · la última vez, el {shortDay(g.last)}{/if}
						</span>
					</span>
					<span class="shrink-0 tabular-nums">{played(g.seconds)}</span>
				</svelte:element>
			</li>
		{/each}
	</ul>

	{#if stats.sessions.length}
		<h2 class="mb-[0.5em] text-[1.25em] font-semibold">Últimas partidas</h2>
		<ul class="divide-y divide-white/10 rounded-xl border border-white/10 bg-zinc-900">
			{#each stats.sessions as s (s.id)}
				<li class="flex items-baseline justify-between gap-[1em] px-[0.75em] py-[0.5em]">
					<span class="min-w-0">
						<span class="block truncate">{s.title}</span>
						<span class="block text-[0.8em] text-zinc-400 first-letter:uppercase">
							{day(s.startedAt)}, de {hour(s.startedAt)} a {hour(s.endedAt)}
						</span>
					</span>
					<span class="shrink-0 tabular-nums">{played(s.seconds)}</span>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
