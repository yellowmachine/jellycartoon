<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section, select } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Los satélites de voz que sirve Seilide (#296): una Raspberry en una habitación, con su clave,
	 * también sin jellycartoon. Uno de la casa se puede traer aquí con su mismo id: guarda lo que
	 * aprendió y sus alarmas.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
</script>

{#if data.satellites}
	<section class={section} id="satelites">
		<h2 class="mb-1 font-semibold">Satélites de voz</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Una Raspberry con micrófono y altavoz en una habitación, que contesta con la voz de la
			familia, también sin jellycartoon. Cada uno con su clave: va en su <span class="font-mono"
				>.env</span
			>, con <span class="font-mono">SERVER_URL={data.satellites.origin}</span>. Sin la casa aún no
			pone música ni radio; temporizadores, alarmas, agenda, nevera y lo que recuerda, sí.
		</p>

		{#if form && 'satelliteKey' in form}
			<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				<p class="mb-1">
					Clave de «{form.satelliteName}», su <span class="font-mono">SATELLITE_KEY</span>:
				</p>
				<p class="font-mono break-all text-amber-300 select-all">{form.satelliteKey}</p>
				<p class="mt-1 text-xs text-zinc-400">Cópiala ahora: no se vuelve a enseñar.</p>
			</div>
		{/if}

		{#if data.satellites.own.length}
			<ul class="mb-4 divide-y divide-zinc-800 text-sm">
				{#each data.satellites.own as s (s.id)}
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{s.name}
							<span class="block text-xs text-zinc-500">
								<span class="font-mono">{s.start}…</span> · desde el {day(s.createdAt)}
								{#if s.lastSeenAt}· oído el {day(s.lastSeenAt)}{:else}· aún sin conectar{/if}
							</span>
						</span>
						<form method="post" action="?seccion={tab}&/deleteSatellite" use:enhance>
							<input type="hidden" name="id" value={s.id} />
							<button class={secondary}>Quitar</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			method="post"
			action="?seccion={tab}&/createSatellite"
			use:enhance
			class="flex flex-wrap items-center gap-2"
		>
			{#if data.satellites.house.length}
				<select name="adopt" class={select}>
					<option value="">Uno nuevo</option>
					{#each data.satellites.house as h (h.id)}
						<option value={h.id}>El de la casa: {h.name}</option>
					{/each}
				</select>
			{/if}
			<input name="name" maxlength="40" placeholder="Dormitorio" class="{field} min-w-0 flex-1" />
			<button class={primary}>Añadir</button>
		</form>
		{#if data.satellites.house.length}
			<p class="mt-2 text-xs text-zinc-500">
				Uno de la casa se trae con su mismo nombre (si no le pones otro), y guarda lo que aprendió y
				sus alarmas. Mientras no le cambies la clave en la Raspberry, sigue hablando con la casa.
			</p>
		{/if}
		{#if form && 'satelliteProblem' in form}
			<p class="mt-3 text-sm text-red-400">{form.satelliteProblem}</p>
		{/if}
	</section>
{/if}
