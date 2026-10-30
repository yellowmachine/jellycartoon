<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Where the children enter by choosing their drawing (#303): this device marked as the
	 * family's by its administrator, or not; and, in Familia, all of them.
	 */
	let {
		data,
		form,
		tab,
		all = false
	}: { data: PageData; form: ActionData; tab: string; all?: boolean } = $props();
</script>

{#if data.kidDevices}
	<section class={section} id="aparato-peques">
		{#if all}
			<h2 class="mb-1 font-semibold">Aparatos de los peques</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Donde los peques entran eligiendo su dibujo. Se marcan en cada uno, en Ajustes → Este
				aparato.
			</p>
			{#if data.kidDevices.all.length}
				<ul class="divide-y divide-zinc-800 text-sm">
					{#each data.kidDevices.all as d (d.id)}
						<li class="flex items-center gap-3 py-2">
							<span class="min-w-0 flex-1 truncate">{d.name}</span>
							<form method="post" action="?seccion={tab}&/forgetKidDevice" use:enhance>
								<input type="hidden" name="id" value={d.id} />
								<button class={secondary}>Quitar</button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-zinc-500">Ninguno todavía.</p>
			{/if}
		{:else}
			<h2 class="mb-1 font-semibold">Aparato de los peques</h2>
			{#if data.kidDevices.here}
				<p class="mb-3 text-sm text-zinc-400">
					Este aparato es de los peques («{data.kidDevices.here}»): al entrar sale «¿Quién eres?» y
					eligen su dibujo; a sus mayores les llega la petición al móvil.
				</p>
				<form method="post" action="?seccion={tab}&/untrustKidDevice" use:enhance>
					<button class={secondary}>Ya no es de los peques</button>
				</form>
			{:else}
				<p class="mb-3 text-sm text-zinc-400">
					Márcalo si es la tablet o el ordenador de los peques: entrarán eligiendo su dibujo, sin
					contraseña, cuando uno de sus mayores les deje.
				</p>
				<form
					method="post"
					action="?seccion={tab}&/trustKidDevice"
					use:enhance
					class="flex flex-wrap gap-2"
				>
					<input
						name="name"
						placeholder="Su nombre: la tablet, el ordenador…"
						maxlength="40"
						required
						class={field}
					/>
					<button class={primary}>Es de los peques</button>
				</form>
			{/if}
		{/if}
		{#if form && 'kidDeviceProblem' in form}
			<p class="mt-3 text-sm text-red-400">{form.kidDeviceProblem}</p>
		{/if}
	</section>
{/if}
