<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Satélites de voz (#223): un aparato en una habitación que oye «hola casita», con su clave. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
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
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{s.name}
							<span class="block text-xs text-zinc-500">
								<span class="font-mono">{s.start}…</span> · creado el {day(s.createdAt)}
								{#if s.lastRequest}· usado el {day(s.lastRequest)}{:else}· sin usar{/if}
							</span>
						</span>
						<span class="flex shrink-0 items-center gap-2">
							{#if data.satelliteSpeakers?.length}
								<form method="post" action="?seccion={tab}&/saveSatelliteSpeaker" use:enhance>
									<input type="hidden" name="id" value={s.id} />
									<select
										name="speaker"
										aria-label="Su altavoz de la casa"
										value={s.speakerId ?? ''}
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
										class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
									>
										<option value="">Sin altavoz</option>
										{#each data.satelliteSpeakers as sp (sp.id)}
											<option value={sp.id}>{sp.name}{sp.connected ? '' : ' (apagado)'}</option>
										{/each}
										{#if s.speakerId && !data.satelliteSpeakers.some((sp) => sp.id === s.speakerId)}
											<option value={s.speakerId}>Uno que ya no está</option>
										{/if}
									</select>
								</form>
							{/if}
							<form method="post" action="?seccion={tab}&/deleteSatellite" use:enhance>
								<input type="hidden" name="id" value={s.id} />
								<button class={secondary}>Quitar</button>
							</form>
						</span>
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
			{#if data.satelliteSpeakers?.length}
				Su altavoz es el de Snapcast de su habitación: mientras te oye y contesta, la música baja
				ahí.
			{/if}
			Quitarlo deja sin entrar al aparato que usaba esa clave.
		</p>
	</section>
{/if}
