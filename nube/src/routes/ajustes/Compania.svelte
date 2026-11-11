<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section, select } from '#lib/styles.ts';
	import CompanionChecks from '#lib/components/CompanionChecks.svelte';
	import type { ActionData, PageData } from './$types';

	/**
	 * «Compañía» (#469), for someone who lives alone: a satellite asks them now and then how they are,
	 * and with no answer after a few tries the linked families are told. Set here, in their family,
	 * by whoever runs it; the linked families see it in /compania.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const c = $derived(data.companion);
	const s = $derived(c?.settings);
	const satellites = $derived(data.satellites?.own ?? []);
	const linked = $derived(data.familyLinks?.linked ?? []);
	const saved = $derived(form && 'saved' in form ? form.saved : null);
	const problem = $derived(form && 'companionProblem' in form ? form.companionProblem : null);
	const EVERY = [15, 20, 30, 45, 60, 90, 120, 180, 240];
	const everyText = (m: number) =>
		m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h y media` : `${m / 60} h`;
</script>

{#if c}
	<section class={section} id="compania">
		<h2 class="mb-1 font-semibold">Compañía</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Para quien vive solo: cada rato, un satélite le pregunta cómo está, con sus palabras, y espera
			que conteste, sin decir la palabra de activación. Si no contesta, lo vuelve a intentar; si
			sigue sin contestar, avisa a los mayores de las familias vinculadas, que solo ven si contestó
			(✓) o no (✗), nunca lo que dijo. Si sale de casa, que lo diga («Okapi, me voy a comprar»; al
			volver, «ya estoy aquí»); desde una familia vinculada también se puede pausar.
		</p>
		<p class="mb-4 text-xs text-zinc-500">
			Es una ayuda, no un servicio de teleasistencia: si se va la luz o internet, no puede preguntar
			(eso también se avisa).
		</p>

		{#if !satellites.length}
			<p class="mb-3 text-sm text-amber-400">
				Hace falta un satélite de voz en su casa (arriba, en «Satélites de voz»).
			</p>
		{/if}
		{#if !linked.length}
			<p class="mb-3 text-sm text-amber-400">
				Sin familias vinculadas no se avisa a nadie: vincula la de quien vaya a estar pendiente, en
				«Familias vinculadas».
			</p>
		{/if}

		<form
			method="post"
			action="?seccion={tab}&/saveCompanion"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="flex flex-col gap-4 text-sm"
		>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="on" checked={s?.on ?? false} />
				Preguntarle cada rato
			</label>

			<label class="flex flex-col gap-1 text-zinc-400">
				Cómo le llama
				<input
					name="name"
					value={s?.name ?? ''}
					maxlength="40"
					placeholder="Carmen"
					class="{field} min-w-40"
				/>
			</label>

			{#if satellites.length > 1}
				<fieldset class="flex flex-col gap-1">
					<legend class="mb-1 text-zinc-400">Desde qué satélites (ninguno marcado: todos)</legend>
					{#each satellites as sat (sat.id)}
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								name="satellite"
								value={sat.id}
								checked={s?.satelliteIds.includes(sat.id) ?? false}
							/>
							{sat.name}
						</label>
					{/each}
				</fieldset>
			{/if}

			<div class="flex flex-wrap items-center gap-2 text-zinc-300">
				Cada
				<select name="everyMinutes" class={select} value={s?.everyMinutes ?? 30}>
					{#each EVERY as m (m)}
						<option value={m}>{everyText(m)}</option>
					{/each}
				</select>
				de
				<input type="time" name="fromTime" required value={s?.fromTime ?? '09:00'} class={select} />
				a
				<input type="time" name="toTime" required value={s?.toTime ?? '22:00'} class={select} />
			</div>

			<div class="flex flex-wrap items-center gap-2 text-zinc-300">
				Si no contesta, lo intenta
				<input
					type="number"
					name="retries"
					min={c.limits.retries.min}
					max={c.limits.retries.max}
					value={s?.retries ?? 2}
					class="{select} w-16"
				/>
				veces más, cada
				<input
					type="number"
					name="retryMinutes"
					min={c.limits.retryMinutes.min}
					max={c.limits.retryMinutes.max}
					value={s?.retryMinutes ?? 2}
					class="{select} w-16"
				/>
				min, y luego avisa.
			</div>

			<div class="flex flex-wrap items-center gap-3">
				<button class={primary}>Guardar</button>
				{#if saved === 'companion'}
					<Guardado class="text-amber-400">✓ Guardado</Guardado>
				{/if}
			</div>
			{#if problem}
				<p class="text-sm text-red-400">{problem}</p>
			{/if}
		</form>

		{#if s?.on}
			<div class="mt-5 border-t border-zinc-800 pt-4">
				{#if c.view}
					<CompanionChecks view={c.view} />
				{/if}
				<form method="post" action="?seccion={tab}&/askCompanionNow" use:enhance class="mt-3">
					<button class={secondary}>Preguntar ahora</button>
					{#if saved === 'companionAsk'}
						<Guardado class="ml-2 text-sm text-amber-400"
							>Pregunta en menos de un minuto, si está dentro de sus horas</Guardado
						>
					{/if}
				</form>
			</div>
		{/if}
	</section>
{/if}
