<script lang="ts">
	import { enhance } from '$app/forms';
	import { frameTimes } from '#lib/birds-eye.ts';
	import { formatDuration } from '#lib/format.ts';

	interface Props {
		movieId: number;
		durationSec: number;
		/** Whether «Ver desde aquí» can play it on the host's screen. */
		mpv: boolean;
	}

	let { movieId, durationSec, mpv }: Props = $props();

	let shown = $state(false);
	let selected = $state(0);
	let playing = $state<string | null>(null);
	let failed = $state<string | null>(null);
	let dialog = $state<HTMLDialogElement>();

	const times = $derived(frameTimes(durationSec));
	const src = (at: number, width?: number) =>
		`/api/movie-frame/${movieId}/${at}${width ? `?w=${width}` : ''}`;

	function open(index: number) {
		selected = index;
		playing = failed = null;
		dialog?.showModal();
	}

	const move = (step: number) => {
		selected = (selected + step + times.length) % times.length;
		playing = failed = null;
	};

	const button = 'rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800';
</script>

<section class="mt-8">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="font-semibold">Vista de pájaro</h2>
		{#if !shown}
			<button onclick={() => (shown = true)} class={button}>
				Ver {times.length} fotogramas
			</button>
		{/if}
	</div>

	{#if shown}
		<!-- A contact sheet: the whole film on one screen, also on a phone. -->
		<ul class="grid grid-cols-4 gap-1 sm:grid-cols-5 sm:gap-2">
			{#each times as at, i (at)}
				<li>
					<button
						onclick={() => open(i)}
						class="block aspect-video w-full overflow-hidden rounded bg-zinc-800 hover:opacity-80"
						aria-label="Fotograma en {formatDuration(at)}"
					>
						<img
							src={src(at)}
							alt=""
							title={formatDuration(at)}
							class="h-full w-full object-cover"
						/>
					</button>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-xs text-zinc-500">
			Pulsa uno para verlo en grande. Se sacan del fichero al pedirlos y tardan unos segundos.
		</p>
	{/if}
</section>

<dialog
	bind:this={dialog}
	closedby="any"
	onkeydown={(e) => {
		if (e.key === 'ArrowLeft') move(-1);
		if (e.key === 'ArrowRight') move(1);
	}}
	class="m-auto w-5xl max-w-[calc(100vw-1rem)] rounded-md border border-zinc-700 bg-zinc-900 p-3 text-zinc-100 shadow-lg backdrop:bg-zinc-950/80"
>
	{#if times[selected] !== undefined}
		{@const at = times[selected]}
		<!-- The small one, already loaded, shows until the big one arrives. -->
		<div
			class="aspect-video w-full rounded bg-zinc-800 bg-cover bg-center"
			style:background-image="url({src(at)})"
		>
			{#key at}
				<img
					src={src(at, 1280)}
					alt="Fotograma en {formatDuration(at)}"
					class="h-full w-full rounded object-contain"
				/>
			{/key}
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button onclick={() => move(-1)} class={button} aria-label="Anterior">‹</button>
			<span class="text-sm text-zinc-300 tabular-nums">{formatDuration(at)}</span>
			<button onclick={() => move(1)} class={button} aria-label="Siguiente">›</button>
			{#if mpv}
				<form
					method="post"
					action="?/play"
					use:enhance={() =>
						async ({ result }) => {
							if (result.type === 'success') playing = formatDuration(at);
							else if (result.type === 'failure')
								failed = String(result.data?.message ?? 'No se pudo reproducir');
						}}
				>
					<input type="hidden" name="id" value={movieId} />
					<input type="hidden" name="at" value={at} />
					<button
						class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
						>▶︎ Ver desde aquí en el salón</button
					>
				</form>
			{/if}
			<form method="dialog" class="ml-auto">
				<button class={button}>Cerrar</button>
			</form>
		</div>
		{#if playing}
			<p class="mt-2 text-sm text-amber-400">
				▶︎ En el salón desde {playing}. <a href="/salon" class="underline">Abrir el mando</a>
			</p>
		{/if}
		{#if failed}
			<p class="mt-2 text-sm text-red-400">{failed}</p>
		{/if}
	{/if}
</dialog>
