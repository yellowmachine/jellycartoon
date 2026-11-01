<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Los satélites de voz que sirve Seilide (#296): una Raspberry en una habitación, con su clave,
	 * también sin jellycartoon; con la casa, su snapserver hace de su altavoz.
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
			>, con <span class="font-mono">SERVER_URL={data.satellites.origin}</span>. Sin la casa, sin
			música ni radio; temporizadores, alarmas, agenda, nevera y lo que recuerda, sí. Con la casa,
			su snapserver (su IP en casa) hace que la música suene también en esa habitación: se le dice
			al momento, sin tocar la Raspberry.
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
					<li class="flex flex-col gap-2 py-2">
						<div class="flex items-center justify-between gap-2">
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
						</div>
						<!-- The house's music in its room: its own snapclient, told at once. -->
						<form
							method="post"
							action="?seccion={tab}&/saveSnapserver"
							use:enhance={() =>
								async ({ update }) =>
									update({ reset: false })}
							class="flex flex-wrap items-center gap-2 text-xs text-zinc-400"
						>
							<input type="hidden" name="id" value={s.id} />
							<label class="flex min-w-0 flex-1 items-center gap-2">
								Música (snapserver)
								<input
									name="snapserver"
									value={s.snapserver ?? ''}
									maxlength="80"
									placeholder="192.168.1.20"
									class="{field} min-w-0 flex-1 py-1 text-xs"
								/>
							</label>
							<button class={secondary}>Guardar</button>
						</form>
						<!-- #361: saved as soon as it is touched. -->
						<form
							method="post"
							action="?seccion={tab}&/saveConversation"
							use:enhance={() =>
								async ({ update }) =>
									update({ reset: false })}
							class="text-xs text-zinc-400"
						>
							<input type="hidden" name="id" value={s.id} />
							<label class="flex items-start gap-2">
								<input
									type="checkbox"
									name="conversation"
									checked={s.conversation}
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
									class="mt-0.5 accent-amber-500"
								/>
								<span>
									Modo conversación: después de contestar, escucha 5 segundos sin la palabra, con un
									pitido suave, por si sigues hablando. Mejor sin tele en la habitación: solo cuenta
									una voz tan fuerte como la tuya, pero podría colarse.
								</span>
							</label>
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
			<input
				name="name"
				required
				maxlength="40"
				placeholder="Dormitorio"
				class="{field} min-w-0 flex-1"
			/>
			<button class={primary}>Añadir</button>
		</form>
		{#if form && 'satelliteProblem' in form}
			<p class="mt-3 text-sm text-red-400">{form.satelliteProblem}</p>
		{/if}
	</section>
{/if}
