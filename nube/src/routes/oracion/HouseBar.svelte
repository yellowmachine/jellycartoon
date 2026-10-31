<script lang="ts">
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import { formatDuration } from 'comun/format.ts';
	import type { HouseNow } from '#lib/prayers.ts';

	/**
	 * What the whole house plays of Oración (#339), as the music bar shows what plays here: where it
	 * goes (it can be moved), what it is, the time and its buttons. Asked every few seconds: in
	 * between, its time goes on by itself. `asked`, after a button, to ask again at once.
	 */
	let { now, asked }: { now: HouseNow; asked: () => void } = $props();

	let problem = $state<string | null>(null);

	/** When `now` came, to count the seconds since. */
	let at = $state(Date.now());
	let tick = $state(Date.now());
	$effect.pre(() => {
		void now;
		at = Date.now();
		tick = at;
	});
	$effect(() => {
		if (now.paused) return;
		const timer = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const position = $derived(
		now.positionSec == null
			? 0
			: Math.min(
					now.positionSec + (now.paused ? 0 : (tick - at) / 1000),
					now.durationSec ?? Infinity
				)
	);

	async function send(what: string, value?: number) {
		const res = await fetch('/api/oracion/casa', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ do: what, value })
		}).catch(() => null);
		problem = res
			? ((await res.json().catch(() => null))?.problem ?? (res.ok ? null : 'No se pudo'))
			: 'Sin conexión';
		asked();
	}

	// As the music bar's (comun's MusicBar).
	const base =
		'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40';
	const control = `${base} bg-zinc-800 text-zinc-200 hover:bg-zinc-700`;
	const primary = `${base} bg-amber-500 text-zinc-950 hover:bg-amber-400`;
	const ghost = `${base} text-zinc-400 hover:bg-zinc-800 hover:text-white`;
</script>

<div class="mb-6 rounded-md border border-zinc-700 bg-zinc-900/80 p-2">
	<input
		type="range"
		min="0"
		max={now.durationSec ?? 0}
		step="1"
		value={position}
		disabled={!now.durationSec}
		aria-label="Posición"
		class="mb-1 block h-1 w-full accent-amber-500"
		onchange={(e) => send('seek', Number(e.currentTarget.value))}
	/>
	<div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex-nowrap sm:gap-3">
		<div class="order-1 flex min-w-0 flex-1 items-center gap-3">
			<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800">🔊</span
			>
			<span class="min-w-0">
				<span class="block truncate text-sm">{now.title}</span>
				{#if problem}
					<span class="block truncate text-xs text-amber-400">{problem}</span>
				{:else}
					<span class="block truncate text-xs text-zinc-400">En toda la casa · {now.album}</span>
				{/if}
			</span>
		</div>
		<button
			class="{ghost} order-2 sm:order-9"
			aria-label="Parar"
			title="Parar en toda la casa"
			onclick={() => send('stop')}><MediaIcon name="close" /></button
		>
		<span class="order-3 basis-full sm:hidden" aria-hidden="true"></span>
		<span class="order-4 font-mono text-[11px] text-zinc-400 tabular-nums sm:text-xs">
			{formatDuration(position) || '0:00'} / {formatDuration(now.durationSec)}
		</span>
		<span class="order-6 ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">
			<button
				class="{control} max-sm:h-8 max-sm:w-8"
				aria-label="Anterior"
				onclick={() => send('previous')}><MediaIcon name="previous" /></button
			>
			<button
				class={primary}
				aria-label={now.paused ? 'Seguir' : 'Pausa'}
				onclick={() => send(now.paused ? 'resume' : 'pause')}
				><MediaIcon name={now.paused ? 'play' : 'pause'} /></button
			>
			<button
				class="{control} max-sm:h-8 max-sm:w-8"
				aria-label="Siguiente"
				disabled={now.last}
				onclick={() => send('next')}><MediaIcon name="next" /></button
			>
		</span>
	</div>
</div>
