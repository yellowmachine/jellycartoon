<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { cost } from 'comun/ai-spend.ts';
	import { addDays, localDay } from 'comun/agenda.ts';
	import { enhance } from '$app/forms';
	import { field, section, select, secondary } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';
	import type { Outcome } from '#lib/server/rule-sim.ts';
	import type { SimulationAsked } from '#lib/server/rules.ts';

	type Simulation = { asked: SimulationAsked; problem?: string } & Partial<{
		outcomes: Outcome[];
		unasked: number;
		cost: number | null;
	}>;

	/**
	 * Las reglas (#331): se dicen con palabras («cuando vengan mis padres, si estoy de viaje,
	 * recuérdame lo de las plantas»), aquí o a la voz; la IA las entiende una vez y luego se
	 * comprueban solas. Cada una como la entendió, la última vez que avisó y por qué; y Pausar,
	 * Probar, Cambiar (se reescribe y se vuelve a entender) y Borrar. Las tuyas solo las ves tú.
	 * Y «¿Qué pasaría…?» (#389): todas en un momento que elijas, sin avisar ni guardar nada, y
	 * «y si…» cambia lo que haya entonces (el tiempo, un viaje, las tomas, algo dicho).
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	let editing = $state<number | null>(null);
	/** «Probar»'s answer, under its rule. */
	const tried = $derived(
		form && 'ruleTried' in form ? (form.ruleTried as { id: number; said: string }) : null
	);
	const when = (d: Date) =>
		d.toLocaleString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	/** «¿Qué pasaría…?» (#389): what was asked, and what it would do. */
	const sim = $derived(form && 'simulation' in form ? (form.simulation as Simulation) : null);
	const ifs = $derived(sim?.asked.ifs);
	const hasIfs = $derived(
		Boolean(
			ifs && (ifs.weather !== 'prevision' || ifs.away || ifs.doses !== 'como_esten' || ifs.happens)
		)
	);
	const today = localDay();
	const nextHour = `${String((new Date().getHours() + 1) % 24).padStart(2, '0')}:00`;
	const DOES = { avisa: '🔔', deduce: '💡' } as const;
	let simulating = $state(false);

	const problemFor = (id: number | null) =>
		form && 'ruleProblem' in form && (form.ruleId ?? null) === id ? form.ruleProblem : null;
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset: boolean }) => Promise<void> }) =>
			update({ reset: false });
</script>

<section class={section} id="reglas">
	<h2 class="mb-1 font-semibold">Reglas</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Dile cuándo avisar y de qué, con tus palabras: «cuando vengan mis padres, si estoy de viaje,
		recuérdame que les diga lo de las plantas», «si alguien pone leche en la lista, avísame». Mira
		la Agenda, la nevera, lo que recuerda, tus viajes y la hora; avisa en tu
		<a href="/buzon" class="text-amber-400 hover:underline">Buzón</a> y en el móvil. También por voz:
		«Alexa, crea una regla…».
	</p>

	<details class="mb-4 text-sm">
		<summary class="cursor-pointer text-amber-400">Reglas listas para activar</summary>
		<ul class="mt-2 flex flex-col gap-2">
			{#each data.ruleTemplates as t (t.id)}
				<li class="flex items-start gap-3">
					<div class="min-w-0 flex-1">
						<p class="text-zinc-200">{t.title}</p>
						<p class="text-xs text-zinc-500">{t.does}</p>
					</div>
					{#if t.on}
						<span class="text-xs text-amber-400">Activada</span>
					{:else}
						<form method="post" action="?seccion={tab}&/activateTemplate" use:enhance={keep}>
							<input type="hidden" name="id" value={t.id} />
							<button class={secondary}>Activar</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</details>

	{#if data.rules.length}
		<ul class="mb-4 flex flex-col divide-y divide-zinc-800 text-sm">
			{#each data.rules as r (r.id)}
				<li class="py-2">
					{#if editing === r.id}
						<form
							method="post"
							action="?seccion={tab}&/saveRule"
							use:enhance={() =>
								async ({ result, update }) => {
									await update({ reset: false });
									if (result.type === 'success') editing = null;
								}}
							class="flex flex-col gap-2"
						>
							<input type="hidden" name="id" value={r.id} />
							<textarea name="text" rows="2" maxlength="500" class={field}>{r.said}</textarea>
							<div class="flex gap-2">
								<button class={secondary}>Guardar</button>
								<button type="button" class={secondary} onclick={() => (editing = null)}
									>Cancelar</button
								>
							</div>
						</form>
					{:else}
						<p class={r.paused ? 'text-zinc-500' : 'text-zinc-200'}>
							{#if r.paused}<span class="text-xs uppercase">En pausa · </span>{/if}
							{r.understood}
						</p>
						<p class="text-xs text-zinc-500">
							{r.mine ? 'Solo tuya' : 'De toda la casa'}{r.aloud
								? ' · También en voz alta en casa'
								: ''} · Dicho: «{r.said}»
						</p>
						{#if r.lastFiredAt}
							<p class="text-xs text-zinc-500">
								Avisó el {when(r.lastFiredAt)}{r.lastWhy ? `, porque ${r.lastWhy}` : ''}.
							</p>
						{/if}
						{#if tried?.id === r.id}
							<p class="text-xs text-amber-400">{tried.said}</p>
						{/if}
						<div class="mt-1 flex flex-wrap gap-2">
							<form method="post" action="?seccion={tab}&/pauseRule" use:enhance={keep}>
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="paused" value={String(!r.paused)} />
								<button class={secondary}>{r.paused ? 'Seguir' : 'Pausar'}</button>
							</form>
							<form method="post" action="?seccion={tab}&/tryRule" use:enhance={keep}>
								<input type="hidden" name="id" value={r.id} />
								<button class={secondary}>Probar</button>
							</form>
							<button class={secondary} onclick={() => (editing = r.id)}>Cambiar</button>
							<form method="post" action="?seccion={tab}&/deleteRule" use:enhance={keep}>
								<input type="hidden" name="id" value={r.id} />
								<button class={secondary} aria-label="Borrar «{r.understood}»">Borrar</button>
							</form>
						</div>
					{/if}
					{#if problemFor(r.id)}
						<p class="text-sm text-red-400">{problemFor(r.id)}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<form
		method="post"
		action="?seccion={tab}&/saveRule"
		use:enhance={() =>
			async ({ result, update }) =>
				update({ reset: result.type === 'success' })}
		class="flex flex-col gap-2 text-sm"
	>
		<textarea
			name="text"
			rows="2"
			maxlength="500"
			required
			placeholder="Cuando vengan mis padres, si estoy de viaje, recuérdame que les diga lo de las plantas"
			class={field}></textarea>
		<div class="flex flex-wrap items-center gap-2">
			<select name="whose" class={select}>
				<option value="me">Solo mía</option>
				<option value="house">De la casa</option>
			</select>
			<button class={secondary}>Crear la regla</button>
			{#if form && 'saved' in form && form.saved === 'rule' && 'ruleId' in form}
				<Guardado class="text-amber-400">✓ Entendida</Guardado>
			{/if}
		</div>
		{#if problemFor(null)}
			<p class="text-sm text-red-400">{problemFor(null)}</p>
		{/if}
	</form>

	<details class="mt-4 text-sm" open={Boolean(sim)}>
		<summary class="cursor-pointer text-amber-400">¿Qué pasaría…?</summary>
		<p class="mt-2 mb-3 text-zinc-400">
			Elige un momento y mira qué harían tus reglas y las de la casa entonces, con lo que hay en la
			Agenda, los viajes, Medicación y la previsión del tiempo. No se avisa a nadie ni se guarda
			nada. Puedes probar también una regla nueva antes de crearla.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/simulateRules"
			use:enhance={() => {
				simulating = true;
				return async ({ update }) => {
					await update({ reset: false });
					simulating = false;
				};
			}}
			class="flex flex-col gap-2"
		>
			<div class="flex flex-wrap items-center gap-2">
				<input
					type="date"
					name="day"
					min={today}
					max={addDays(today, 7)}
					value={sim?.asked.day ?? today}
					required
					class={field}
				/>
				<input type="time" name="time" value={sim?.asked.time ?? nextHour} required class={field} />
				<select name="span" value={sim?.asked.wholeDay ? 'dia' : 'hora'} class={select}>
					<option value="hora">esa hora</option>
					<option value="dia">hasta el final del día</option>
				</select>
			</div>
			<details class="rounded-md border border-zinc-800 px-3 py-2" open={hasIfs}>
				<summary class="cursor-pointer text-zinc-300">Y si…</summary>
				<div class="mt-2 flex flex-col gap-2">
					<label class="flex flex-wrap items-center gap-2">
						<span class="text-zinc-400">El tiempo:</span>
						<select name="ifWeather" value={ifs?.weather ?? 'prevision'} class={select}>
							<option value="prevision">como diga la previsión</option>
							<option value="lluvia">que llueva</option>
							<option value="sin_lluvia">que no llueva (ni nada)</option>
							<option value="helada">que hiele</option>
							<option value="calor">que haga mucho calor</option>
							<option value="viento">que haga mucho viento</option>
							<option value="nieve">que nieve</option>
						</select>
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" name="ifAway" checked={ifs?.away ?? false} />
						<span>Que yo esté de viaje ese día</span>
					</label>
					<label class="flex flex-wrap items-center gap-2">
						<span class="text-zinc-400">Medicación:</span>
						<select name="ifDoses" value={ifs?.doses ?? 'como_esten'} class={select}>
							<option value="como_esten">las tomas, como estén</option>
							<option value="sin_marcar">ninguna toma marcada</option>
							<option value="marcadas">todas las tomas marcadas</option>
						</select>
					</label>
					<div class="flex flex-col gap-2">
						<select name="ifKind" value={ifs?.happens?.kind ?? 'dicho'} class="{select} self-start">
							<option value="dicho">Que diga a la voz</option>
							<option value="nevera">Que ponga en la nevera</option>
							<option value="recuerdo">Que pida recordar</option>
							<option value="compra">Que se compre (separado por comas)</option>
						</select>
						<input
							name="ifText"
							maxlength="200"
							placeholder="voy a poner la lavadora"
							value={ifs?.happens?.text ?? ''}
							class="{field} w-full"
						/>
					</div>
					<p class="text-xs text-zinc-500">
						Lo que digas, pongas o se compre, a la hora elegida. El tiempo inventado vale para todo
						el rato que miras.
					</p>
				</div>
			</details>
			<textarea
				name="draft"
				rows="2"
				maxlength="500"
				placeholder="Y una regla nueva, para probarla sin crearla (si quieres)"
				class={field}>{sim?.asked.draft ?? ''}</textarea
			>
			<div class="flex flex-wrap items-center gap-2">
				<select name="whose" value={sim?.asked.draftHouse ? 'house' : 'me'} class={select}>
					<option value="me">Solo mía</option>
					<option value="house">De la casa</option>
				</select>
				<button class={secondary} disabled={simulating}>
					{simulating ? 'Mirando…' : 'Mirar qué pasaría'}
				</button>
			</div>
			{#await data.ruleDraftCost then price}
				{#if price !== null}
					<p class="text-xs text-zinc-500">
						Probar una regla nueva la tiene que entender la IA: unos {cost(price)}. Las que ya
						tienes, gratis; lo que solo se sabe por el sentido, lo preguntas tú abajo.
					</p>
				{/if}
			{/await}

			{#if sim?.problem}
				<p class="text-sm text-red-400">{sim.problem}</p>
			{:else if sim?.outcomes}
				<ul class="mt-2 flex flex-col divide-y divide-zinc-800">
					{#each sim.outcomes as o, i (i)}
						<li class="py-2">
							<p class={o.does ? 'text-zinc-100' : 'text-zinc-400'}>
								{#if o.at}<span class="text-amber-400 tabular-nums">{o.at}</span> ·{/if}
								{#if o.does}{DOES[o.does]}{/if}
								{o.said}
							</p>
							<p class="text-xs text-zinc-500">
								{o.id === null ? 'La nueva: ' : ''}{o.understood}
							</p>
						</li>
					{/each}
				</ul>
				{#if sim.unasked}
					<div class="mt-2 flex flex-wrap items-center gap-2">
						<p class="text-xs text-zinc-400">
							{sim.unasked === 1 ? 'Una cosa' : `${sim.unasked} cosas`} no {sim.unasked === 1
								? 'la dicen'
								: 'las dicen'} sus palabras, solo el sentido: aquí se ha mirado solo por las palabras.
						</p>
						<button name="ai" value="1" class={secondary} disabled={simulating}>
							Preguntarlo a la IA{sim.cost != null ? ` (unos ${cost(sim.cost)})` : ''}
						</button>
					</div>
				{/if}
			{/if}
		</form>
	</details>
</section>
