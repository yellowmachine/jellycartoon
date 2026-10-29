<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Someone into the family (#279): an email with its link, which lasts 7 days, as svelte-thinking's
	 * invitations. Those not yet accepted, to send again or cancel. Only its administrator.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const problem = $derived(form && 'inviteProblem' in form ? form.inviteProblem : null);
	// typeof: requireAdmin's failure (+page.server.ts) has any key, as a string.
	const invited = $derived(
		form && 'invited' in form && typeof form.invited === 'object' ? form.invited : null
	);
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
	/** The link just copied, to say so on its button. */
	let copied = $state<string | null>(null);
	let busy = $state(false);

	async function copy(link: string) {
		await navigator.clipboard.writeText(link);
		copied = link;
		setTimeout(() => (copied = copied === link ? null : copied), 2000);
	}
</script>

{#if data.invitations}
	<section class={section} id="invitaciones">
		<h2 class="mb-1 font-semibold">Invitaciones</h2>
		<p class="mb-4 text-sm text-zinc-400">
			A quien invitas le llega un correo con un enlace para crear su cuenta y entrar en la familia.
			Caduca a los 7 días; si no lo encuentra, mándaselo otra vez o copia el enlace.
		</p>

		<form
			method="post"
			action="?seccion={tab}&/invite"
			class="mb-4 flex flex-col gap-3"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<input
				type="email"
				name="email"
				required
				maxlength={200}
				placeholder="Su email"
				autocomplete="off"
				class={field}
			/>
			<label class="flex items-center gap-2 text-sm text-zinc-300">
				<input
					type="checkbox"
					name="admin"
					class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
				/>
				También administra la familia
			</label>
			<button disabled={busy} class="{primary} self-start">{busy ? 'Enviando…' : 'Invitar'}</button>
		</form>
		{#if problem}
			<p class="mb-3 text-sm text-red-400">{problem}</p>
		{:else if invited}
			<p class="mb-3 text-sm {invited.sent ? 'text-zinc-300' : 'text-amber-400'}">
				{invited.sent
					? `Invitación enviada a ${invited.email}.`
					: `La invitación está hecha, pero el correo a ${invited.email} no salió: cópiale el enlace.`}
			</p>
		{/if}

		{#if data.invitations.length}
			<ul class="divide-y divide-zinc-800">
				{#each data.invitations as i (i.id)}
					<li class="flex flex-wrap items-center gap-2 py-2">
						<span class="min-w-0 flex-1 truncate">
							{i.email}
							<span class="text-xs text-zinc-500">
								{i.role === 'admin' ? '· administra' : ''}
								{i.status === 'expired' ? '· caducada' : `· hasta el ${day(i.expiresAt)}`}
							</span>
						</span>
						{#if i.status === 'pending'}
							<button class={secondary} onclick={() => copy(i.link)}>
								{copied === i.link ? 'Copiado' : 'Copiar enlace'}
							</button>
						{/if}
						<form method="post" action="?seccion={tab}&/invite" use:enhance>
							<input type="hidden" name="email" value={i.email} />
							{#if i.role === 'admin'}<input type="hidden" name="admin" value="on" />{/if}
							<button class={secondary}>Reenviar</button>
						</form>
						<form method="post" action="?seccion={tab}&/cancelInvitation" use:enhance>
							<input type="hidden" name="id" value={i.id} />
							<button class={secondary}>Cancelar</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
