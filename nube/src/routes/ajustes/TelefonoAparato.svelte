<script lang="ts">
	import { onMount } from 'svelte';
	import { simPhone } from '#lib/sim-phone.svelte.ts';
	import { isCallable, numberText } from '#lib/sim-number.ts';
	import { field, primary, secondary, section } from '#lib/styles.ts';

	/**
	 * «Este aparato puede llamar por teléfono» (#330): a device with a SIM (the car's tablet) also
	 * calls as a phone, from the road mode and by voice. Its contacts stay here.
	 */

	/** This device's choice is only known in the browser. */
	let mounted = $state(false);
	onMount(() => (mounted = true));

	let name = $state('');
	let number = $state('');
	let note = $state<string | null>(null);

	function add(e: SubmitEvent) {
		e.preventDefault();
		if (!simPhone.add({ name, number })) {
			note = 'Pon un nombre y un número de teléfono.';
			return;
		}
		name = '';
		number = '';
		note = null;
	}

	async function pick() {
		const added = await simPhone.pick();
		note = added ? null : 'No se ha añadido ninguno.';
	}
</script>

<section class={section} id="telefono">
	<h2 class="mb-1 font-semibold">Llamar por teléfono</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Si este aparato tiene tarjeta SIM (la tablet del coche), también llama como un teléfono normal:
		desde el modo carretera, en «Más → Llamar», y por voz («llama a la farmacia», «llama al 968…»).
		Seilide abre el teléfono de Android con el número puesto y tú tocas llamar; al colgar, vuelves
		aquí. Los contactos se quedan en este aparato: a la voz solo le llega su nombre.
	</p>
	<label class="flex items-start gap-2 text-sm">
		<input
			type="checkbox"
			checked={mounted && simPhone.on}
			onchange={(e) => simPhone.set(e.currentTarget.checked)}
			class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
		/>
		<span>Este aparato puede llamar por teléfono</span>
	</label>

	{#if mounted && simPhone.on}
		<h3 class="mt-5 mb-2 text-sm font-semibold">Contactos de este aparato</h3>
		{#if simPhone.contacts.length}
			<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each simPhone.contacts as c (c.name)}
					<li class="flex items-center gap-3 px-3 py-2 text-sm">
						<span class="min-w-0 flex-1 truncate">{c.name}</span>
						<span class="text-zinc-400 tabular-nums">{numberText(c.number)}</span>
						<button type="button" class={secondary} onclick={() => simPhone.remove(c.name)}
							>Quitar</button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mb-4 text-sm text-zinc-400">Aún ninguno.</p>
		{/if}

		{#if simPhone.canPick}
			<button type="button" class={[primary, 'mb-4']} onclick={pick}>Añadir de la agenda</button>
		{/if}

		<form class="flex flex-wrap items-end gap-2" onsubmit={add}>
			<label class="min-w-40 flex-1 text-sm">
				Nombre
				<input class={field} bind:value={name} maxlength="60" placeholder="Farmacia" />
			</label>
			<label class="min-w-40 flex-1 text-sm">
				Teléfono
				<input class={field} type="tel" bind:value={number} placeholder="968 12 34 56" />
			</label>
			<button
				class={secondary}
				disabled={!name.trim() || !isCallable(number)}
				aria-disabled={!name.trim() || !isCallable(number)}>Añadir</button
			>
		</form>
		{#if note}
			<p class="mt-2 text-sm text-amber-300">{note}</p>
		{/if}
	{/if}
</section>
