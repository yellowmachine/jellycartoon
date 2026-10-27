<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Satélites de voz (#223): un aparato en una habitación que oye «hola casita», con su clave. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

	/** Snapcast's speakers (#223): where its music is lowered, and where it may answer. */
	const speakers = $derived(data.satelliteSpeakers);

	/** Them, and the one chosen if it is no longer there. */
	const options = (chosen: string | null) => [
		...(speakers ?? []).map((sp) => ({
			id: sp.id,
			name: `${sp.name}${sp.connected ? '' : ' (apagado)'}`
		})),
		...(chosen && !speakers?.some((sp) => sp.id === chosen)
			? [{ id: chosen, name: 'Uno que ya no está' }]
			: [])
	];

	const submit = (e: Event) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
</script>

{#if data.satellites}
	<section class={section} id="satelites">
		<h2 class="mb-1 font-semibold">Satélites de voz</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Un aparato con micrófono en una habitación (una Raspberry en el salón) que oye «hola casita» y
			manda la orden, sin pantalla. Cada uno entra con su clave. Lo que se le dice va como dicho por
			la casa: sin nombre ni historial de nadie; lo que apunta (la agenda, una nota) queda a tu
			nombre.
		</p>

		{#if form && 'satelliteKey' in form}
			<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				<p class="mb-1">Clave de «{form.satelliteName}»:</p>
				<p class="font-mono break-all text-amber-300 select-all">{form.satelliteKey}</p>
				<p class="mt-1 text-xs text-zinc-400">
					Cópiala ahora en el <code>.env</code> del satélite (<code>SATELLITE_KEY</code>): no se
					vuelve a enseñar.
				</p>
			</div>
		{/if}

		{#if data.satellites.length}
			<ul class="mb-4 divide-y divide-zinc-800 text-sm">
				{#each data.satellites as s (s.id)}
					<li class="py-2">
						<div class="flex items-center justify-between gap-2">
							<span>
								{s.name}
								<span class="block text-xs text-zinc-500">
									<span class="font-mono">{s.start}…</span> · creado el {day(s.createdAt)}
									{#if s.lastRequest}· usado el {day(s.lastRequest)}{:else}· sin usar{/if}
								</span>
							</span>
							<form method="post" action="?seccion={tab}&/deleteSatellite" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<button class={secondary}>Quitar</button>
							</form>
						</div>
						{#if speakers?.length}
							<form
								method="post"
								action="?seccion={tab}&/saveSatelliteSpeakers"
								use:enhance
								class="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-400"
							>
								<input type="hidden" name="id" value={s.id} />
								<label class="flex items-center gap-2">
									Baja la música en
									<select
										name="speaker"
										value={s.speakerId ?? ''}
										onchange={submit}
										class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
									>
										<option value="">Ningún altavoz</option>
										{#each options(s.speakerId) as sp (sp.id)}
											<option value={sp.id}>{sp.name}</option>
										{/each}
									</select>
								</label>
								{#if data.satelliteAnswers}
									<label class="flex items-center gap-2">
										Contesta por
										<select
											name="answer"
											value={s.answerOn ?? ''}
											onchange={submit}
											class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
										>
											<option value="">El altavoz del satélite</option>
											<option value="house">Toda la casa</option>
											{#each options(s.answerOn === 'house' ? null : s.answerOn) as sp (sp.id)}
												<option value={sp.id}>{sp.name}</option>
											{/each}
										</select>
									</label>
								{:else}
									<input type="hidden" name="answer" value={s.answerOn ?? ''} />
								{/if}
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<form
			method="post"
			action="?seccion={tab}&/createSatellite"
			use:enhance
			class="flex flex-wrap gap-2"
		>
			<input
				name="name"
				required
				maxlength="32"
				placeholder="Satélite del salón"
				class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
			/>
			<button class={primary}>Añadir satélite</button>
		</form>
		{#if form && 'satelliteProblem' in form}
			<p class="mt-2 text-sm text-red-400">{form.satelliteProblem}</p>
		{/if}
		<p class="mt-2 text-xs text-zinc-500">
			{#if speakers?.length}
				La música baja en el altavoz de Snapcast de su habitación mientras te oye y contesta.
				{#if data.satelliteAnswers}
					Si contesta por Snapcast, esos altavoces dejan la música mientras habla (con un segundo de
					retraso) y luego vuelven a ella.
				{/if}
			{/if}
			Quitarlo deja sin entrar al aparato que usaba esa clave.
		</p>
	</section>
{/if}
