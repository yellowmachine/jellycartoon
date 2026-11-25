<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import EnchufesTabs from '#lib/components/EnchufesTabs.svelte';
	import TemperatureChart from '#lib/components/TemperatureChart.svelte';
	import { field, primary } from '#lib/styles.ts';
	import {
		SENSOR_COLORS,
		TEMPERATURE_RANGES,
		type SensorView,
		type TemperatureSeries
	} from '#lib/temperature.ts';
	import type { PageProps } from './$types';

	/**
	 * Enchufes → Temperatura (#508): outside where they live, as Open-Meteo estimates it, and each
	 * room's sensor (a Shelly H&T) with its card and its line in the same chart. The sensors wake
	 * every 10 minutes or so: the page asks again every minute.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.outside);

	$effect(() => {
		const every = setInterval(() => void refreshAll(), 60_000);
		return () => clearInterval(every);
	});

	const series = $derived<TemperatureSeries[]>([
		...data.sensors.map((s, i) => ({
			name: s.name,
			points: s.points,
			color: SENSOR_COLORS[i % SENSOR_COLORS.length]!
		})),
		...(o?.hours.length
			? [{ name: 'Fuera', points: o.hours, color: 'text-zinc-400', dashed: true }]
			: [])
	]);

	const hourFormat = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
	const dayFormat = new Intl.DateTimeFormat('es-ES', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
	/** When its last reading came: «hace 4 min», «a las 14:30», «el 18 nov, 14:30». */
	function readText(at: string) {
		const when = new Date(at);
		const minutes = Math.floor((Date.now() - when.getTime()) / 60_000);
		if (minutes < 1) return 'ahora mismo';
		if (minutes < 60) return `hace ${minutes} min`;
		if (when.toDateString() === new Date().toDateString())
			return `a las ${hourFormat.format(when)}`;
		return `el ${dayFormat.format(when)}`;
	}
	const batteryText = (s: SensorView) =>
		s.external ? 'Con USB' : s.battery === null ? null : `Pilas ${s.battery} %`;
	/** «Humedad 48 % · Con USB». */
	const detailText = (s: SensorView) =>
		[s.humidity === null ? null : `Humedad ${Math.round(s.humidity)} %`, batteryText(s)]
			.filter(Boolean)
			.join(' · ');
	let renaming = $state<string | null>(null);

	const degrees = (c: number) =>
		`${c.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
	const RANGE_LABELS: Record<(typeof TEMPERATURE_RANGES)[number], string> = {
		2: '2 días',
		7: '7 días',
		30: '30 días'
	};
	const tab = 'rounded-md px-3 py-1.5 text-sm';
</script>

<svelte:head>
	<title>Temperatura · Energía · Seilide</title>
</svelte:head>

<h1 class="mb-3 text-2xl font-bold">Energía</h1>
<EnchufesTabs current="temperatura" />

{#if data.sensors.length}
	<section class="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
		{#each data.sensors as s, i (s.id)}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
				<p class="flex items-center gap-2 text-sm text-zinc-400">
					<span
						class="inline-block h-2.5 w-2.5 rounded-full bg-current {SENSOR_COLORS[
							i % SENSOR_COLORS.length
						]}"
						aria-hidden="true"
					></span>
					{s.name}
					{#if s.home && data.sensors.length > 1}
						<span class="ml-auto rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300"
							>🏠 El de casa</span
						>
					{/if}
				</p>
				{#if s.at === null}
					<p class="mt-1 text-zinc-400">Esperando su primera lectura…</p>
					<p class="mt-1 text-xs text-zinc-500">
						Manda la temperatura cada 10 minutos más o menos.
					</p>
				{:else}
					<p class="mt-1 text-3xl font-semibold text-zinc-100 tabular-nums">
						{s.tempC === null ? '—' : degrees(s.tempC)}
					</p>
					<p class="mt-1 text-sm text-zinc-400 tabular-nums">
						{detailText(s)}
					</p>
					<p class="mt-1 text-xs {s.silent ? 'text-amber-400' : 'text-zinc-500'}">
						{s.silent ? `Sin noticias desde ${readText(s.at)}` : `Leído ${readText(s.at)}`}
					</p>
				{/if}
				{#if renaming === s.id}
					<form
						method="POST"
						action="?/rename"
						class="mt-3 flex gap-2"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								renaming = null;
							}}
					>
						<input type="hidden" name="id" value={s.id} />
						<input
							name="name"
							value={s.name}
							maxlength="40"
							aria-label="Habitación"
							class="{field} py-1 text-sm"
						/>
						<button class={primary}>Guardar</button>
					</form>
				{:else}
					<div class="mt-3 flex gap-4 border-t border-zinc-800 pt-2">
						<button
							type="button"
							class="text-sm text-zinc-500 hover:text-white"
							onclick={() => (renaming = s.id)}>Cambiar nombre</button
						>
						{#if data.sensors.length > 1}
							<form method="POST" action="?/home" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<input type="hidden" name="home" value={String(!s.home)} />
								<button
									class="text-sm text-zinc-500 hover:text-white"
									title="El que miran las reglas que dicen «si en casa hay menos de 15 grados»"
									>{s.home ? 'Ya no es el de casa' : 'Es el de casa'}</button
								>
							</form>
						{/if}
						<ConfirmForm
							action="?/remove"
							fields={{ id: s.id }}
							label="Quitar"
							question="¿Quitar este sensor? Se pierden sus lecturas. Si está despierto, se le dice que deje de conectarse."
							yes="Sí, quitar"
							class="text-sm text-zinc-500 hover:text-red-400"
						/>
					</div>
				{/if}
			</div>
		{/each}
	</section>
{/if}

{#if !data.place}
	<p class="mb-4 text-zinc-400">
		Pon dónde vivís en <a
			href="/ajustes?seccion=familia#donde-vivis"
			class="text-amber-400 hover:underline">Ajustes</a
		> para ver aquí la temperatura de fuera.
	</p>
{:else if !o}
	<p class="mb-4 text-zinc-400">
		No se pudo saber la temperatura de fuera. Prueba dentro de un rato.
	</p>
{:else}
	<section class="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
		<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
			<p class="text-sm text-zinc-400">Fuera · {data.place}</p>
			<p class="mt-1 text-3xl font-semibold text-zinc-100 tabular-nums">{degrees(o.temperature)}</p>
			<p class="mt-1 text-sm text-zinc-400 tabular-nums">
				Humedad {o.humidity} % · hoy entre {o.min}° y {o.max}°
			</p>
		</div>
	</section>
{/if}

{#if series.some((s) => s.points.length > 1)}
	<div class="mb-2 flex items-center justify-between gap-2">
		<h2 class="font-semibold">Hora a hora</h2>
		<nav class="flex gap-1" aria-label="Cuánto tiempo">
			{#each TEMPERATURE_RANGES as d (d)}
				<a
					href="?dias={d}"
					class="{tab} {data.days === d
						? 'bg-zinc-100 text-zinc-900'
						: 'bg-zinc-800 hover:bg-zinc-700'}"
					aria-current={data.days === d ? 'page' : undefined}>{RANGE_LABELS[d]}</a
				>
			{/each}
		</nav>
	</div>
	<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
		<TemperatureChart series={series.filter((s) => s.points.length)} />
	</div>
{/if}
{#if o}
	<p class="mt-3 text-xs text-zinc-500">
		Fuera es la estimación de <a
			href="https://open-meteo.com/"
			target="_blank"
			rel="noopener"
			class="hover:text-white hover:underline">Open-Meteo</a
		> para el sitio de «Dónde vivís», no un termómetro: puede apartarse unos grados de tu calle.
	</p>
{/if}
