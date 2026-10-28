<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import AvatarPicker from 'comun/components/AvatarPicker.svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { avatar } from 'comun/avatars.ts';
	import { section, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Cuenta: salir y tu dibujo. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if page.url.searchParams.has('bienvenida')}
	<p
		class="mb-6 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300"
		role="status"
	>
		✓ Ya estás dentro. Aquí puedes elegir tu dibujo y, mejor aún, activar la verificación en dos
		pasos: aunque alguien supiera tu contraseña, sin tu móvil no entraría.
	</p>
{/if}
<section class={section} id="cuenta">
	<h2 class="mb-3 font-semibold">Cuenta</h2>
	<form method="post" action="/logout" class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm">
			{data.account.name} · <span class="text-zinc-400">{data.account.email}</span>
		</p>
		<button class={secondary}>Salir</button>
	</form>
	{#if data.account.avatar !== undefined}
		<form
			method="post"
			action="?seccion={tab}&/myAvatar"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mt-4 flex flex-col gap-3"
		>
			<p class="text-sm text-zinc-400">Tu dibujo, en el círculo de arriba:</p>
			<AvatarPicker chosen={data.account.avatar} label="Tu dibujo" />
			<div class="flex items-center gap-3">
				<button class="{primary} self-start">Guardar</button>
				{#if form && 'saved' in form && form.saved === 'avatar'}
					<Guardado class="text-sm text-amber-400">✓ Guardado</Guardado>
				{:else if form && 'section' in form && form.section === 'avatar'}
					<span class="text-sm text-red-400">{form.message}</span>
				{/if}
			</div>
		</form>
	{/if}
</section>
