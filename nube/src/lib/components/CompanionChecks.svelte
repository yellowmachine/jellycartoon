<script lang="ts">
	/**
	 * «Compañía» (#469), how it is going: the alert if there is one, the pause, the last answer, and
	 * today's and yesterday's askings as ✓ and ✗ (never what was said). In Ajustes and /compania.
	 */
	interface View {
		asking: boolean;
		lastAnswerAt: Date | null;
		paused: { until: Date; by: string | null } | null;
		alert: { kind: 'silent' | 'offline'; since: Date } | null;
		fromTime: string;
		toTime: string;
		checks: { at: Date; answered: boolean }[];
	}
	let { view }: { view: View } = $props();

	const time = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
	const today = new Date().toDateString();
	const when = (d: Date) => (d.toDateString() === today ? time(d) : `ayer ${time(d)}`);
	const todays = $derived(view.checks.filter((c) => c.at.toDateString() === today));
	const yesterdays = $derived(view.checks.filter((c) => c.at.toDateString() !== today));
</script>

{#if view.alert?.kind === 'silent'}
	<p class="mb-2 font-semibold text-red-400">⚠️ No contesta desde las {time(view.alert.since)}</p>
{:else if view.alert?.kind === 'offline'}
	<p class="mb-2 font-semibold text-red-400">
		⚠️ Su satélite no responde desde las {time(view.alert.since)}: no se le puede preguntar
	</p>
{/if}
{#if view.paused}
	<p class="mb-2 text-sm text-zinc-300">
		⏸ En pausa hasta {when(view.paused.until)}{view.paused.by ? ` (${view.paused.by})` : ''}
	</p>
{/if}
<p class="mb-2 text-sm text-zinc-400">
	{#if view.asking}
		Preguntándole ahora…
	{:else if view.lastAnswerAt}
		Última señal: {when(view.lastAnswerAt)}
	{:else}
		Aún no ha contestado nunca
	{/if}
	· de {view.fromTime} a {view.toTime}
</p>
{#each [{ label: 'Hoy', list: todays }, { label: 'Ayer', list: yesterdays }] as day (day.label)}
	{#if day.list.length}
		<p class="mt-2 text-xs text-zinc-500">{day.label}</p>
		<ul class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
			{#each [...day.list].reverse() as c (c.at.getTime())}
				<li class={c.answered ? 'text-emerald-400' : 'text-red-400'}>
					{time(c.at)}
					{c.answered ? '✓' : '✗'}
				</li>
			{/each}
		</ul>
	{/if}
{/each}
