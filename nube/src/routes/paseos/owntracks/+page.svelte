<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import PaseosTabs from '#lib/components/PaseosTabs.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import { agoText } from '#lib/cars.ts';
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
	const arrow = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
</script>

<svelte:head>
	<title>OwnTracks · Paseos · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Paseos<GuideLink page="paseos" label="los paseos" /></h1>
<p class="mb-4 text-sm text-zinc-400">Tiempo, km y recorrido al salir a andar, solo para ti.</p>

<PaseosTabs current="owntracks" />

{#if !data.status.connectedAt && !data.status.last}
	<section class="rounded-md border border-zinc-800 p-6 text-center">
		<p class="mb-2 text-lg">📍 Tu móvil, sin abrir Seilide</p>
		<p class="mx-auto mb-4 max-w-md text-sm text-zinc-400">
			Con la app OwnTracks en Android, tu móvil manda dónde está aunque lleves la pantalla apagada,
			y aquí ves por dónde has ido cada día. Solo lo ves tú.
		</p>
		<a
			href="/ajustes?seccion=mi#owntracks"
			class="inline-block rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400"
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
		{:else}
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
		<p class="mb-2 text-sm text-zinc-400">
			{data.line.length}
			{data.line.length === 1 ? 'posición' : 'posiciones'}, de {time.format(new Date(data.first!))} a
			{time.format(new Date(data.last!))}.
		</p>
		{#key data.day}
			<TripMap line={data.line} />
		{/key}
	{:else}
		<p class="rounded-md border border-zinc-800 p-4 text-sm text-zinc-500">
			Ese día no llegó nada.
		</p>
	{/if}
{/if}
