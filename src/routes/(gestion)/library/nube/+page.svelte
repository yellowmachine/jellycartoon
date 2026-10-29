<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
	const dollars = (cost: number) => `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
	let sending = $state(false);
</script>

<h1 class="mb-2 text-2xl font-bold">Seilide</h1>
<p class="mb-6 text-sm text-zinc-400">
	Los gastos de IA de casa que no llegaron a Seilide (sin internet, o Seilide sin contestar). Se
	mandan solos con el siguiente que llegue bien; desde aquí, cuando quieras. Seilide no cuenta
	ninguno dos veces.
</p>

{#if form && 'sent' in form}
	<p
		class={[
			'mb-4 rounded-md border p-3 text-sm',
			form.error ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10'
		]}
	>
		{#if form.sent}Enviados {form.sent}.{/if}
		{#if form.error}{form.error}{form.left ? ` · Quedan ${form.left}.` : ''}{:else if !form.left}Ya
			no queda ninguno.{/if}
	</p>
{/if}

{#if !data.unsent.length}
	<p class="text-sm text-zinc-500">No queda nada por mandar: Seilide lo tiene todo.</p>
{:else}
	<div class="mb-4 flex items-center justify-between gap-3">
		<p class="text-sm">
			<strong>{data.unsent.length}</strong> sin mandar ·
			{dollars(data.unsent.reduce((sum, c) => sum + c.cost, 0))}
		</p>
		<form
			method="post"
			action="?/resend"
			use:enhance={() => {
				sending = true;
				return async ({ update }) => {
					await update();
					sending = false;
				};
			}}
		>
			<button
				disabled={sending}
				class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
			>
				{sending ? 'Reenviando…' : 'Reenviar todos'}
			</button>
		</form>
	</div>

	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
		{#each data.unsent as c (c.id)}
			<li class="flex items-center gap-3 p-3">
				<p class="min-w-0 flex-1">
					<span class="block truncate">{c.label}</span>
					<span class="block truncate text-xs text-zinc-500">
						{dateTime.format(c.at)} · {c.error}{c.tries > 1 ? ` · ${c.tries} intentos` : ''}
					</span>
				</p>
				<span class="shrink-0 font-mono text-zinc-300">{dollars(c.cost)}</span>
				<form method="post" action="?/forget" use:enhance>
					<input type="hidden" name="id" value={c.id} />
					<button
						class="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900"
						title="No mandarlo"
					>
						Quitar
					</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}
