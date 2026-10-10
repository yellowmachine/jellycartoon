<script lang="ts">
	import { formatDuration } from '#lib/format.ts';
	import { trackLabel, watchSalon } from '#lib/salon.svelte.ts';

	const salon = watchSalon();
	const mpv = $derived(salon.state);

	/** While the bar is being dragged it shows the finger, not mpv. */
	let dragging = $state<number | null>(null);

	const audio = $derived(mpv?.tracks.filter((t) => t.type === 'audio') ?? []);
	const subtitles = $derived(mpv?.tracks.filter((t) => t.type === 'sub') ?? []);

	const shape = 'flex h-14 items-center justify-center rounded-md';
	const button = `${shape} bg-zinc-800 text-lg hover:bg-zinc-700 active:bg-zinc-600`;
	const mainButton = `${shape} bg-amber-500 text-2xl text-zinc-950 hover:bg-amber-400 active:bg-amber-300`;
	const choice = (selected: boolean) => [
		'rounded-md px-3 py-2 text-sm',
		selected ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
	];
</script>

<div class="mx-auto max-w-md">
	{#if !mpv}
		<p class="text-zinc-400">Conectando…</p>
	{:else if !mpv.available}
		<p class="text-zinc-400">
			mpv no está esperando en el salón. Comprueba el servicio:
			<code class="text-xs">systemctl --user status jellycartoon-mpv</code>
		</p>
	{:else if !mpv.active}
		<p class="text-zinc-400">
			No se está viendo nada. Elige una película en <a href="/cine" class="text-amber-400">Cine</a>.
		</p>
	{:else}
		<h2 class="mb-4 text-xl font-semibold">{mpv.title}</h2>

		<input
			type="range"
			min="0"
			max={mpv.durationSec ?? 0}
			step="1"
			value={dragging ?? mpv.positionSec ?? 0}
			aria-label="Posición"
			class="w-full accent-amber-500"
			oninput={(e) => (dragging = Number(e.currentTarget.value))}
			onchange={(e) => {
				salon.send({ action: 'seekTo', value: Number(e.currentTarget.value) });
				dragging = null;
			}}
		/>
		<div class="mb-5 flex justify-between font-mono text-sm text-zinc-400 tabular-nums">
			<span>{formatDuration(dragging ?? mpv.positionSec) || '0:00'}</span>
			<span>{formatDuration(mpv.durationSec)}</span>
		</div>

		<div class="mb-3 grid grid-cols-5 gap-2">
			<button
				class={button}
				aria-label="Atrás 1 minuto"
				onclick={() => salon.send({ action: 'seek', value: -60 })}>−1m</button
			>
			<button
				class={button}
				aria-label="Atrás 10 segundos"
				onclick={() => salon.send({ action: 'seek', value: -10 })}>−10</button
			>
			<button
				class={mainButton}
				aria-label={mpv.paused ? 'Seguir' : 'Pausa'}
				onclick={() => salon.send({ action: 'pause', value: !mpv.paused })}
				>{mpv.paused ? '▶\uFE0E' : '❚❚'}</button
			>
			<button
				class={button}
				aria-label="Adelante 10 segundos"
				onclick={() => salon.send({ action: 'seek', value: 10 })}>+10</button
			>
			<button
				class={button}
				aria-label="Adelante 1 minuto"
				onclick={() => salon.send({ action: 'seek', value: 60 })}>+1m</button
			>
		</div>

		<div class="mb-6 flex items-center gap-3">
			<span class="text-sm text-zinc-400">Volumen</span>
			<input
				type="range"
				min="0"
				max="100"
				step="5"
				value={mpv.volume ?? 100}
				aria-label="Volumen"
				class="flex-1 accent-amber-500"
				onchange={(e) => salon.send({ action: 'volume', value: Number(e.currentTarget.value) })}
			/>
			<span class="w-10 text-right font-mono text-sm text-zinc-400 tabular-nums"
				>{Math.round(mpv.volume ?? 100)}</span
			>
		</div>

		{#if audio.length > 1}
			<h3 class="mb-2 text-sm text-zinc-400">Audio</h3>
			<div class="mb-5 flex flex-wrap gap-2">
				{#each audio as track (track.id)}
					<button
						class={choice(track.id === mpv.audioId)}
						onclick={() => salon.send({ action: 'audio', value: track.id })}
						>{trackLabel(track)}</button
					>
				{/each}
			</div>
		{/if}

		{#if subtitles.length}
			<h3 class="mb-2 text-sm text-zinc-400">Subtítulos</h3>
			<div class="mb-6 flex flex-wrap gap-2">
				<button
					class={choice(mpv.subtitleId === null)}
					onclick={() => salon.send({ action: 'subtitle', value: null })}>No</button
				>
				{#each subtitles as track (track.id)}
					<button
						class={choice(track.id === mpv.subtitleId)}
						onclick={() => salon.send({ action: 'subtitle', value: track.id })}
						>{trackLabel(track)}</button
					>
				{/each}
			</div>
		{/if}

		<button
			class="w-full rounded-md border border-zinc-700 py-3 text-zinc-300 hover:bg-zinc-900"
			onclick={() => salon.send({ action: 'stop' })}>■ Parar</button
		>
	{/if}

	{#if salon.error}
		<p class="mt-4 text-sm text-red-400">{salon.error}</p>
	{/if}
</div>
