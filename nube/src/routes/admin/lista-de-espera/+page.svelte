<script lang="ts">
	import { enhance } from '$app/forms';
	import { primary, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * The families that asked to come in (the landing page's «Pedir acceso»), as svelte-thinking's
	 * /admin/waitlist: let in, each gets a link to make its own family; or not.
	 */
	let { data, form }: PageProps = $props();

	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
	const STATUS = { pending: 'Esperando', approved: 'Con acceso', rejected: 'Rechazada' } as const;
	let copied = $state(false);
</script>

<svelte:head>
	<title>Lista de espera · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-1 text-2xl font-bold">Lista de espera</h1>
	<p class="mb-6 text-sm text-zinc-400">
		Las familias que han pedido acceso desde la portada. Al darles acceso les llega un enlace para
		crear su cuenta y su familia, que caduca a los 7 días.
	</p>

	{#if form && 'problem' in form}
		<p class="mb-4 text-sm text-red-400">{form.problem}</p>
	{:else if form && 'approved' in form && form.approved}
		<p class="mb-4 text-sm {form.approved.sent ? 'text-zinc-300' : 'text-amber-400'}">
			{form.approved.sent
				? `Enlace enviado a ${form.approved.email}.`
				: `El correo a ${form.approved.email} no salió: pásale el enlace.`}
			<button
				class="ml-1 text-amber-400 hover:underline"
				onclick={async () => {
					await navigator.clipboard.writeText(form.approved.link);
					copied = true;
				}}>{copied ? 'Copiado' : 'Copiar enlace'}</button
			>
		</p>
	{/if}

	{#if !data.entries.length}
		<p class="text-zinc-400">Nadie ha pedido acceso todavía.</p>
	{:else}
		<ul class="space-y-3">
			{#each data.entries as e (e.id)}
				<li class={section.replace('mb-8 ', '')}>
					<div class="flex flex-wrap items-baseline gap-x-2">
						<strong>{e.name}</strong>
						<span class="text-sm text-zinc-400">{e.email}</span>
						<span class="ml-auto text-xs text-zinc-500">{day(e.createdAt)}</span>
					</div>
					{#if e.message}
						<p class="mt-2 text-sm whitespace-pre-line text-zinc-300">{e.message}</p>
					{/if}
					<div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
						<span class="text-zinc-400">
							{e.hasAccount
								? 'Ya tiene cuenta'
								: e.invitation === 'expired'
									? 'Su enlace caducó'
									: STATUS[e.status]}
						</span>
						{#if !e.hasAccount}
							{#if e.status !== 'approved' || e.invitation !== 'pending'}
								<form method="post" action="?/approve" use:enhance class="ml-auto">
									<input type="hidden" name="id" value={e.id} />
									<button class={primary}>
										{e.status === 'approved' ? 'Mandar otro enlace' : 'Dar acceso'}
									</button>
								</form>
							{:else}
								<form method="post" action="?/approve" use:enhance class="ml-auto">
									<input type="hidden" name="id" value={e.id} />
									<button class={secondary}>Reenviar</button>
								</form>
							{/if}
							{#if e.status === 'pending'}
								<form method="post" action="?/reject" use:enhance>
									<input type="hidden" name="id" value={e.id} />
									<button class={secondary}>Rechazar</button>
								</form>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
