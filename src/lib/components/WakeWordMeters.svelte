<script lang="ts">
	import { WAKE_MARGIN, WAKE_THRESHOLD, wakeWord } from '#lib/wake-word.svelte.ts';

	/**
	 * «Avanzado» (#144, Ajustes): under the big microphone, how «hola casita» hears on this device,
	 * live: the microphone's level, the word's score with its threshold, the margin that leaves out a
	 * TV further away with the last order's levels, and the cleaning. Changed
	 * here, kept as in Ajustes. As /activacion's bars, but with what the app really uses.
	 */

	const comma = (n: number) => n.toFixed(2).replace('.', ',');
	const clock = (at: number) =>
		new Date(at).toLocaleTimeString('es-ES', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});

	/** What the last order heard: the voice, what was left out as background, how it ended. */
	const lastOrder = $derived.by(() => {
		const last = wakeWord.lastOrder;
		if (!last) return null;
		const voiceDb = last.voiceDb === null ? '—' : `${last.voiceDb.toFixed(0)} dB`;
		const background =
			last.backgroundDb === null
				? 'nada de fondo'
				: `de fondo ${last.backgroundDb.toFixed(0)} dB (${comma(last.backgroundMs / 1000)} s sin contar)`;
		const end = last.capped ? '; acabó por tiempo, no por silencio' : '';
		return `Última orden (${clock(last.at)}): tu voz ${voiceDb}, ${background}${end}.`;
	});
</script>

<section class="w-full max-w-md rounded-xl bg-zinc-900 p-4 text-left text-sm">
	<p class="mb-3 text-zinc-300">
		{#if wakeWord.problem}
			<span class="text-red-400">{wakeWord.problem}</span>
		{:else if wakeWord.status === 'on'}
			Escuchando «hola casita»
		{:else if wakeWord.status === 'tap'}
			Toca la pantalla para que empiece a escuchar
		{:else}
			Preparando…
		{/if}
	</p>

	<div class="mb-2 flex items-center gap-2">
		<span class="w-20 shrink-0 text-zinc-400">Micrófono</span>
		<span class="h-3 flex-1 overflow-hidden rounded bg-zinc-800">
			<span
				class="block h-full bg-sky-500"
				style:width="{Math.max(0, (wakeWord.level + 90) / 90) * 100}%"
			></span>
		</span>
		<span class="w-14 text-right text-xs text-zinc-500 tabular-nums"
			>{wakeWord.level.toFixed(0)} dB</span
		>
	</div>

	<div class="mb-3 flex items-center gap-2">
		<span class="w-20 shrink-0 text-zinc-400">Palabra</span>
		<!-- The score now, the recent highest, and the threshold. -->
		<span class="relative h-3 flex-1 overflow-hidden rounded bg-zinc-800">
			<span class="absolute inset-y-0 left-0 bg-amber-500/30" style:width="{wakeWord.peak * 100}%"
			></span>
			<span
				class={[
					'absolute inset-y-0 left-0',
					wakeWord.score >= wakeWord.threshold ? 'bg-green-500' : 'bg-amber-500'
				]}
				style:width="{wakeWord.score * 100}%"
			></span>
			<span class="absolute inset-y-0 w-0.5 bg-white/70" style:left="{wakeWord.threshold * 100}%"
			></span>
		</span>
		<span class="w-14 text-right text-xs text-zinc-500 tabular-nums">{comma(wakeWord.peak)}</span>
	</div>

	<label class="mb-3 flex items-center gap-2">
		<span class="w-20 shrink-0 text-zinc-400">Umbral</span>
		<input
			type="range"
			min={WAKE_THRESHOLD.min}
			max={WAKE_THRESHOLD.max}
			step={WAKE_THRESHOLD.step}
			value={wakeWord.threshold}
			oninput={(e) => wakeWord.setThreshold(Number(e.currentTarget.value))}
			class="flex-1 accent-amber-500"
		/>
		<span class="w-14 text-right font-mono text-amber-400">{comma(wakeWord.threshold)}</span>
	</label>

	<label class="mb-1 flex items-center gap-2">
		<span class="w-20 shrink-0 text-zinc-400">Margen</span>
		<input
			type="range"
			min={WAKE_MARGIN.min}
			max={WAKE_MARGIN.max}
			step={WAKE_MARGIN.step}
			value={wakeWord.margin}
			oninput={(e) => wakeWord.setMargin(Number(e.currentTarget.value))}
			class="flex-1 accent-amber-500"
		/>
		<span class="w-14 text-right font-mono text-amber-400">{wakeWord.margin} dB</span>
	</label>
	<p class="mb-3 text-xs text-zinc-500">
		La voz que llega este tanto más baja que la tuya (una tele lejos) no cuenta como orden.
		{#if lastOrder}<br />{lastOrder}{/if}
	</p>

	<label class="flex items-start gap-2">
		<input
			type="checkbox"
			checked={wakeWord.cleanWhenQuiet}
			onchange={(e) => wakeWord.setCleanWhenQuiet(e.currentTarget.checked)}
			class="mt-0.5 rounded border-zinc-600 bg-zinc-900 text-amber-500"
		/>
		Limpiar el sonido (eco y ruido)
	</label>
	{#if wakeWord.cleanWhenQuiet}
		<label class="mt-2 ml-6 flex items-start gap-2">
			<input
				type="checkbox"
				checked={wakeWord.cleanWhilePlaying}
				onchange={(e) => wakeWord.setCleanWhilePlaying(e.currentTarget.checked)}
				class="mt-0.5 rounded border-zinc-600 bg-zinc-900 text-amber-500"
			/>
			También mientras suena la app
		</label>
	{/if}
	<p class="mt-2 text-xs text-zinc-500">
		{#if wakeWord.cleaning}
			Limpieza: activa.
		{:else if wakeWord.cleanWhenQuiet && wakeWord.playing}
			Limpieza: apagada porque suena algo en la app.
		{:else}
			Limpieza: apagada.
		{/if}
		Al cambiarla, el micrófono se abre de nuevo en un par de segundos.
	</p>

	{#if wakeWord.hits.length}
		<ul class="mt-3 border-t border-zinc-800 pt-2 text-xs">
			{#each wakeWord.hits as hit (hit.at)}
				<li class="flex justify-between gap-2">
					<span class="text-zinc-500 tabular-nums">{clock(hit.at)}</span>
					<span class={hit.fired ? 'text-green-400' : 'text-zinc-400'}
						>{comma(hit.score)} · {hit.fired ? 'saltó' : 'no llegó'}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>
