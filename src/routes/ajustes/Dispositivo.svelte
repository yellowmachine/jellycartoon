<script lang="ts">
	import PushNotices from 'comun/components/PushNotices.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { DEVICE_NAME_MAX, deviceName, shownDeviceName } from 'comun/device-name.svelte.ts';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Este aparato: su nombre y sus avisos. */
	let { data }: { data: PageData } = $props();

	/** This device's name and what it is are only known in the browser. */
	let mounted = $state(false);
	onMount(() => (mounted = true));
</script>

<section class={section} id="este-dispositivo">
	<h2 class="mb-1 font-semibold">Nombre y avisos</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Cómo se llama este navegador: al seguir con la música en otro («Sonaba en el salón») y en lo que
		ven los niños (Infantil: «está viendo… en la tablet»). Escríbelo con el artículo. Vacío, se dice
		la TV, el móvil o el ordenador.
	</p>
	<label for="deviceName" class="mb-1 block text-sm text-zinc-300">Nombre</label>
	<input
		id="deviceName"
		type="text"
		value={deviceName.value}
		oninput={(e) => deviceName.set(e.currentTarget.value)}
		maxlength={DEVICE_NAME_MAX}
		placeholder="el salón"
		autocomplete="off"
		class="w-full rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm sm:w-64"
	/>
	{#if mounted}
		<p class="mt-2 text-sm text-zinc-400">
			Se verá así: <span class="text-zinc-200">«Sonaba en {shownDeviceName(false)}»</span>
		</p>
	{/if}
	<!-- The adults' notices with the app closed: entering on a device (#172), and a child asking to
	     enter (#141) for whoever lets one in. The fridge's and the agenda's, in the cloud (#253). -->
	{#if !data.kid}
		<PushNotices
			about={page.data.guardian
				? 'cuando un peque quiera entrar en un dispositivo de la casa o termine los deberes, y para entrar con tu cuenta en un aparato de la casa'
				: 'para entrar con tu cuenta en un aparato de la casa'}
		/>
	{/if}
</section>
