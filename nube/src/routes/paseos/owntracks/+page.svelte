<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import PaseosTabs from '#lib/components/PaseosTabs.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import { agoText } from '#lib/cars.ts';
	import { durationText } from '#lib/trips.ts';
	import { walkDistanceText } from '#lib/walks.ts';
	import type { PageProps } from './$types';

	/** Paseos → OwnTracks (#593): empty until it is connected; then a day's way, as it came. */
	let { data }: PageProps = $props();

	const dayName = new Intl.DateTimeFormat('es', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone: 'UTC'
	});
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
	const shownDay = $derived(
		data.day === data.today ? 'Hoy' : dayName.format(new Date(`${data.day}T12:00:00Z`))
	);
	const seconds = (o: { startedAt: Date; endedAt: Date }) =>
		(new Date(o.endedAt).getTime() - new Date(o.startedAt).getTime()) / 1000;
	const walked = $derived(data.outings.reduce((sum, o) => sum + o.distance, 0));
	const walkedSeconds = $derived(data.outings.reduce((sum, o) => sum + seconds(o), 0));
	/** The outing on the map, or the whole day. */
	let shown = $state<number | null>(null);
	$effect(() => {
		void data.day;
		shown = null;
	});
	const arrow = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
</script>

<svelte:head>
	<title>OwnTracks · Paseos · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Paseos<GuideLink page="paseos" label="los paseos" /></h1>
<p class="mb-4 text-sm text-zinc-400">Tiempo, km y recorrido al salir a andar, solo para ti.</p>

<PaseosTabs current="owntracks" />

{#if !data.status.connectedAt && !data.status.kept}
	<section class="rounded-md border border-zinc-800 p-6 text-center">
		<p class="mb-2 text-lg">📍 Tu móvil, sin abrir Seilide</p>
		<p class="mx-auto mb-4 max-w-md text-sm text-zinc-400">
			Con la app OwnTracks en Android, tu móvil manda dónde está aunque lleves la pantalla apagada,
			y aquí ves por dónde has ido cada día. Solo lo ves tú.
		</p>
		<a
			href="/ajustes?seccion=mi#owntracks"
			class="inline-block rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
			>Conectar en Ajustes</a
		>
	</section>
{:else}
	<p class="mb-4 text-sm text-zinc-400">
		{#if data.status.last}
			Lo último llegó {agoText(new Date(data.status.last.receivedAt), new Date())}{data.status.last
				.battery !== null
				? `, con la batería al ${data.status.last.battery} %`
				: ''}{data.status.last.device ? ` (${data.status.last.device})` : ''}.
		{:else if data.status.connectedAt}
			Conectado, pero aún no ha llegado nada: abre OwnTracks en el móvil y mira que diga
			«Conectado».
		{/if}
		{#if !data.status.connectedAt}
			Desconectado: <a href="/ajustes?seccion=mi#owntracks" class="text-amber-400 hover:underline"
				>conectar otra vez</a
			>.
		{/if}
	</p>

	<nav class="mb-4 flex items-center gap-3">
		{#if data.before}
			<a href="?dia={data.before}" class={arrow} aria-label="Día anterior">←</a>
		{:else}
			<span class="{arrow} opacity-30">←</span>
		{/if}
		<span class="min-w-0 flex-1 text-center font-semibold first-letter:uppercase">{shownDay}</span>
		{#if data.after}
			<a
				href={data.after === data.today ? '?' : `?dia=${data.after}`}
				class={arrow}
				aria-label="Día siguiente">→</a
			>
		{:else}
			<span class="{arrow} opacity-30">→</span>
		{/if}
	</nav>

	{#if data.line.length}
		<section class="mb-4 grid grid-cols-2 gap-3">
			<div class="rounded-md border border-zinc-800 p-3">
				<p class="mb-1 text-sm text-zinc-400">Andando</p>
				<p class="text-xl font-semibold">{walkDistanceText(walked)}</p>
				<p class="text-sm text-zinc-300">
					{data.outings.length}
					{data.outings.length === 1 ? 'salida' : 'salidas'} · {durationText(walkedSeconds)}
				</p>
			</div>
			<div class="rounded-md border border-zinc-800 p-3">
				<p class="mb-1 text-sm text-zinc-400">Lo guardado</p>
				<p class="text-xl font-semibold">
					{data.line.length}
					{data.line.length === 1 ? 'posición' : 'posiciones'}
				</p>
				<p class="text-sm text-zinc-300">
					de {time.format(new Date(data.first!))} a {time.format(new Date(data.last!))}
				</p>
			</div>
		</section>

		{#if data.outings.length}
			<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each data.outings as o, i (o.startedAt)}
					<li>
						<button
							class={[
								'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-900',
								shown === i && 'bg-zinc-900'
							]}
							aria-pressed={shown === i}
							onclick={() => (shown = shown === i ? null : i)}
						>
							<span class="min-w-0 flex-1"
								>🚶 {time.format(new Date(o.startedAt))} – {time.format(new Date(o.endedAt))}</span
							>
							<span class="text-zinc-300">{walkDistanceText(o.distance)}</span>
							<span class="w-16 text-right text-zinc-500">{durationText(seconds(o))}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mb-4 text-sm text-zinc-500">Ese día no se ve ningún rato andando.</p>
		{/if}

		{#if data.arrivals.length}
			<ul class="mb-4 flex flex-wrap gap-2 text-sm">
				{#each data.arrivals as a (`${a.at}-${a.place}`)}
					<li class="rounded-md border border-zinc-800 px-2 py-1">
						{time.format(new Date(a.at))}
						{a.moment === 'llega' ? 'llegas a' : 'sales de'}
						<b>{a.place}</b>
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.appWalks.length}
			<p class="mb-4 text-sm text-zinc-400">
				Ese día también
				{#each data.appWalks as w, i (w.id)}{i ? ', ' : ' '}<a
						href="/paseos?paseo={w.id}"
						class="text-amber-400 hover:underline"
						>el paseo de las {time.format(new Date(w.startedAt))} ({walkDistanceText(
							w.distance
						)})</a
					>{/each}, desde la app: lo que coincide con {data.appWalks.length === 1 ? 'él' : 'ellos'}
				cuenta allí, no aquí.
			</p>
		{/if}

		<p class="mb-2 text-sm text-zinc-400">
			{shown === null ? 'Todo el día, también en coche.' : 'Esa salida.'}
			{#if shown !== null}
				<button class="text-amber-400 hover:underline" onclick={() => (shown = null)}
					>Ver todo el día</button
				>
			{/if}
		</p>
		{#key `${data.day}-${shown}`}
			<TripMap line={shown === null ? data.line : data.outings[shown]!.line} />
		{/key}
	{:else if data.summary}
		<section class="mb-4 rounded-md border border-zinc-800 p-3">
			<p class="mb-1 text-sm text-zinc-400">Andando</p>
			<p class="text-xl font-semibold">{walkDistanceText(data.summary.distance)}</p>
			<p class="text-sm text-zinc-300">
				{data.summary.outings}
				{data.summary.outings === 1 ? 'salida' : 'salidas'} · {durationText(data.summary.seconds)}
			</p>
		</section>
		<p class="text-sm text-zinc-500">
			Las posiciones se guardan 90 días: de este día solo queda lo andado.
		</p>
	{:else}
		<p class="rounded-md border border-zinc-800 p-4 text-sm text-zinc-500">
			{data.forgotten ? 'De ese día no queda nada.' : 'Ese día no llegó nada.'}
		</p>
	{/if}
{/if}
