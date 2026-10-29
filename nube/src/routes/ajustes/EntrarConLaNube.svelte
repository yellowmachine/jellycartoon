<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * One account for the cloud and the house (#279): the house's «Entrar con la nube» needs a client
	 * of the cloud, made here, its id and secret going into the house's .env. Only the family's
	 * administrator; only the family's people get in through it.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	// typeof: requireAdmin's failure (+page.server.ts) has any key, as a string.
	const made = $derived(
		form && 'houseClient' in form && typeof form.houseClient === 'object' ? form.houseClient : null
	);
	const problem = $derived(form && 'clientProblem' in form ? form.clientProblem : null);
	const env = $derived(
		made && data.houseClients
			? `NUBE_URL=${data.houseClients.origin}\nNUBE_CLIENT_ID=${made.clientId}\nNUBE_CLIENT_SECRET=${made.clientSecret}`
			: ''
	);
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
</script>

{#if data.houseClients}
	<section class={section} id="entrar-con-la-nube">
		<h2 class="mb-1 font-semibold">Entrar en casa con la nube</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Una sola cuenta: en jellycartoon, «Entrar con la nube» trae aquí, a entrar con tu contraseña y
			tu verificación, y de vuelta dentro. Solo entran los de la familia. Crea el acceso con la
			dirección de la casa y pega las tres líneas en su <code>.env</code>; luego, en la casa,
			<code>docker compose -f compose.prod.yaml up -d</code>.
		</p>

		{#if made}
			<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				<pre
					class="font-mono text-xs break-all whitespace-pre-wrap text-amber-300 select-all">{env}</pre>
				<p class="mt-1 text-xs text-zinc-400">Cópialas ahora: el secreto no se vuelve a enseñar.</p>
			</div>
		{/if}

		{#if data.houseClients.clients.length}
			<ul class="mb-4 divide-y divide-zinc-800 text-sm">
				{#each data.houseClients.clients as c (c.clientId)}
					<li class="flex items-center justify-between gap-2 py-2">
						<span class="min-w-0">
							{c.name}
							<span class="block truncate text-xs text-zinc-500">
								<span class="font-mono">{c.clientId}</span>
								{#if c.createdAt}· creado el {day(c.createdAt)}{/if}
							</span>
						</span>
						<form method="post" action="?seccion={tab}&/deleteHouseClient" use:enhance>
							<input type="hidden" name="id" value={c.clientId} />
							<button class={secondary}>Quitar</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<form method="post" action="?seccion={tab}&/createHouseClient" use:enhance class="flex gap-2">
			<input
				name="url"
				type="url"
				required
				placeholder="https://casa.example.com"
				value={data.webUrl ?? ''}
				class="{field} min-w-0 flex-1"
			/>
			<button class={primary}>Crear acceso</button>
		</form>
		{#if problem}<p class="mt-3 text-sm text-red-400">{problem}</p>{/if}
	</section>
{/if}
