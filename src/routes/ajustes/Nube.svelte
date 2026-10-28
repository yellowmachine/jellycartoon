<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** La nube (#253): sus claves para la API de vídeo, guardadas en su servidor. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
</script>

{#if data.cloudKeys}
	<section class={section} id="nube">
		<h2 class="mb-1 font-semibold">La nube</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Para que la app de la nube enseñe las series fuera de casa, por el túnel
			{#if data.cloudKeys.host}(<span class="font-mono">{data.cloudKeys.host}</span>){/if}. Con una
			clave que se guarda en el servidor de la nube, nunca en el navegador. De momento solo para
			adultos.
		</p>

		{#if form && 'cloudKey' in form}
			<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				<p class="mb-1">Clave de «{form.cloudKeyName}»:</p>
				<p class="font-mono break-all text-amber-300 select-all">{form.cloudKey}</p>
				<p class="mt-1 text-xs text-zinc-400">Cópiala ahora: no se vuelve a enseñar.</p>
			</div>
		{/if}

		{#if data.cloudKeys.keys.length}
			<ul class="mb-4 divide-y divide-zinc-800 text-sm">
				{#each data.cloudKeys.keys as k (k.id)}
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{k.name}
							<span class="block text-xs text-zinc-500">
								<span class="font-mono">{k.start}…</span> · creada el {day(k.createdAt)}
								{#if k.lastRequest}· usada el {day(k.lastRequest)}{:else}· sin usar{/if}
							</span>
						</span>
						<form method="post" action="?seccion={tab}&/deleteCloudKey" use:enhance>
							<input type="hidden" name="id" value={k.id} />
							<button class={secondary}>Quitar</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<form method="post" action="?seccion={tab}&/createCloudKey" use:enhance class="flex gap-2">
			<input
				name="name"
				maxlength="32"
				required
				placeholder="Nube"
				class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 text-sm"
			/>
			<button class={primary}>Nueva clave</button>
		</form>
		{#if form && 'cloudKeyProblem' in form}
			<p class="mt-2 text-sm text-red-400">{form.cloudKeyProblem}</p>
		{/if}
	</section>
{/if}
