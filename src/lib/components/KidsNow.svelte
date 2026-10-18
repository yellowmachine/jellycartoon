<script lang="ts">
	import { formatDuration } from '#lib/format.ts';
	import { poll } from '#lib/poll.ts';
	import type { WatchingNow } from '#lib/server/live-watching.ts';

	/**
	 * What each child is watching right now (/infantil), asked again every few seconds while the
	 * page is shown: what, where and by which minute, or since when nothing.
	 */

	let {
		kids,
		initial
	}: {
		kids: { id: string; name: string; lastActivity: Date | null }[];
		initial: WatchingNow[];
	} = $props();

	// From the page, then from each check.
	let watching = $derived<WatchingNow[]>(initial);
	let problem = $state(false);

	$effect(() =>
		poll(async () => {
			const res = await fetch('/infantil/ahora').catch(() => null);
			problem = !res?.ok;
			if (res?.ok) watching = await res.json();
		}, 10_000)
	);

	const since = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
	/** «hace 2 horas», «ayer»… */
	function ago(date: Date) {
		const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60_000);
		if (minutes < 60) return since.format(-minutes, 'minute');
		if (minutes < 48 * 60) return since.format(-Math.round(minutes / 60), 'hour');
		return since.format(-Math.round(minutes / 1440), 'day');
	}
</script>

<section class="mb-10 rounded-md border border-zinc-800 p-4" aria-live="polite">
	<h2 class="mb-3 text-xl font-semibold">Ahora</h2>
	<ul class="space-y-3">
		{#each kids as kid (kid.id)}
			{@const now = watching.find((w) => w.userId === kid.id)}
			<li class="flex items-start gap-3">
				<span
					class={[
						'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
						now ? (now.paused ? 'bg-amber-400' : 'bg-green-500') : 'bg-zinc-700'
					]}
					aria-hidden="true"
				></span>
				<p class="min-w-0">
					<span class="font-semibold">{kid.name}</span>
					{#if now}
						{now.paused ? 'tiene en pausa' : 'está viendo'}
						<a href={now.href} class="text-amber-400 hover:underline">{now.title}</a>
						<span class="block text-sm text-zinc-400">
							{now.detail}{now.positionSec !== null
								? ` · minuto ${Math.floor(now.positionSec / 60)}`
								: ''} · en {now.device}
						</span>
					{:else}
						<span class="text-zinc-400">
							no está viendo nada{kid.lastActivity ? ` · lo último, ${ago(kid.lastActivity)}` : ''}
						</span>
					{/if}
				</p>
			</li>
		{/each}
	</ul>
	{#if problem}
		<p class="mt-3 text-sm text-amber-300">Sin conexión: puede no estar al día.</p>
	{/if}
</section>
