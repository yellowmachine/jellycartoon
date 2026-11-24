<script lang="ts">
	import { enhance } from '$app/forms';
	import { addMonths, euros, monthName } from 'comun/expenses.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { field, primary, secondary, section, select } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * Dinero → Banco (#502): their bunq, by an API key of theirs; the accounts that bring their
	 * payments in; payments of months before, counted first; and disconnecting. The key is never
	 * shown again.
	 */
	let { data, form }: PageProps = $props();

	let busy = $state<string | null>(null);
	let confirmOff = $state(false);

	/** This month and the ones before, as far back as allowed. */
	const months = $derived(
		Array.from({ length: data.maxMonths }, (_, i) => addMonths(data.month, -i))
	);
	let month = $state('');
	$effect.pre(() => {
		if (!month) month = data.month;
	});

	const when = (d: Date | null) =>
		d
			? new Date(d).toLocaleString('es-ES', {
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit'
				})
			: 'todavía no';

	/** While a form is sent, its button says so; then the page's data again. */
	const sending = (name: string) => () => {
		busy = name;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = null;
		};
	};

	const problem = $derived(form && 'problem' in form ? form.problem : null);
	const preview = $derived(form && 'preview' in form ? form.preview : null);
	const imported = $derived(form && 'imported' in form ? form.imported : null);
</script>

<svelte:head>
	<title>Banco · Dinero · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl pb-28">
	<h1 class="mb-3 text-2xl font-bold">Dinero</h1>
	<ExpenseTabs current="banco" />

	{#if data.sandbox}
		<p class="mb-4 rounded-md bg-amber-950 p-3 text-sm text-amber-200">
			Modo de prueba: Seilide habla con el sandbox de bunq, no con tu banco de verdad.
		</p>
	{/if}

	{#if problem}
		<p class="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-200">{problem}</p>
	{/if}

	{#if !data.status}
		<section class={section}>
			<h2 class="mb-1 font-semibold">Conectar bunq</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Cada pago con tu tarjeta o desde tu cuenta de bunq entra solo en Dinero, como un gasto más
				de la familia. Si ya estaba (un ticket, una factura o un gasto fijo), se junta con él y no
				cuenta dos veces. La conexión es solo tuya: nadie más la ve. Los ingresos, los traspasos
				entre tus cuentas y las devoluciones no entran.
			</p>
			<ol class="mb-4 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
				<li>En la app de bunq: Perfil → Seguridad y ajustes → Desarrolladores → Claves de API.</li>
				<li>Añade una clave nueva, llámala «Seilide» y cópiala.</li>
				<li>Pégala aquí. Después eliges qué cuentas entran.</li>
			</ol>
			<form
				method="post"
				action="?/connect"
				use:enhance={sending('connect')}
				class="flex flex-col gap-3"
			>
				<label class="flex flex-col gap-1 text-sm text-zinc-300">
					Clave de API de bunq
					<input
						name="key"
						type="password"
						required
						maxlength="300"
						autocomplete="off"
						class={field}
					/>
				</label>
				<div>
					<button class={primary} disabled={busy !== null}
						>{busy === 'connect' ? 'Conectando…' : 'Conectar'}</button
					>
				</div>
			</form>
		</section>
	{:else}
		{@const status = data.status}
		<section class={section}>
			<h2 class="mb-1 font-semibold">bunq conectado</h2>
			<p class="text-sm text-zinc-400">
				{#if status.hooked}
					bunq avisa a Seilide de cada pago al momento; por si acaso, también se mira cada hora.
				{:else}
					Se mira cada hora si hay pagos nuevos.
				{/if}
				Última vez: {when(status.lastSyncAt)}.
			</p>
			{#if status.problem}
				<p class="mt-2 text-sm text-red-400">{status.problem}</p>
			{/if}
			<form method="post" action="?/sync" use:enhance={sending('sync')} class="mt-3">
				<button class={secondary} disabled={busy !== null}
					>{busy === 'sync' ? 'Mirando…' : 'Traer ahora'}</button
				>
				{#if form && 'done' in form && form.done === 'synced' && !status.problem}
					<span class="ml-2 text-sm text-amber-400">✓ Al día</span>
				{/if}
			</form>
		</section>

		<section class={section}>
			<h2 class="mb-1 font-semibold">Cuentas</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Los pagos de las marcadas entran en Dinero desde ahora. Puedes cambiarlo cuando quieras: lo
				que ya entró de una cuenta desmarcada se queda.
			</p>
			{#if status.accounts.length}
				<form
					method="post"
					action="?/choose"
					use:enhance={sending('choose')}
					class="flex flex-col gap-2"
				>
					{#each status.accounts as a (a.id)}
						<label class="flex items-start gap-2 text-sm">
							<input
								type="checkbox"
								name="account"
								value={a.id}
								checked={a.chosen}
								disabled={a.closed}
								class="mt-0.5 rounded border-zinc-600 bg-zinc-900 text-amber-600"
							/>
							<span>
								{a.name}
								{#if a.iban}<span class="block text-xs text-zinc-500">{a.iban}</span>{/if}
								{#if a.closed}<span class="block text-xs text-zinc-500">Cerrada en bunq</span>{/if}
							</span>
						</label>
					{/each}
					<div class="mt-1 flex items-center gap-3">
						<button class={primary} disabled={busy !== null}
							>{busy === 'choose' ? 'Guardando…' : 'Guardar'}</button
						>
						{#if form && 'done' in form && form.done === 'chosen'}
							<span class="text-sm text-amber-400">✓ Guardado</span>
						{/if}
					</div>
				</form>
			{:else}
				<p class="text-sm text-zinc-400">bunq no ha dado ninguna cuenta.</p>
			{/if}
		</section>

		{#if status.accounts.some((a) => a.chosen)}
			<section class={section}>
				<h2 class="mb-1 font-semibold">Traer pagos anteriores</h2>
				<p class="mb-3 text-sm text-zinc-400">
					Los pagos de las cuentas marcadas desde el mes que elijas. Antes de traer nada, te digo
					cuántos son nuevos y cuántos ya estaban en Dinero. Se puede repetir: ninguno entra dos
					veces.
				</p>
				<form
					method="post"
					action="?/preview"
					use:enhance={sending('preview')}
					class="flex flex-wrap items-center gap-2"
				>
					<label class="text-sm text-zinc-300" for="month">Desde</label>
					<select id="month" name="month" bind:value={month} class={select}>
						{#each months as m, i (m)}
							<option value={m}>{i === 0 ? `Este mes (${monthName(m)})` : monthName(m)}</option>
						{/each}
					</select>
					<button class={secondary} disabled={busy !== null}
						>{busy === 'preview' ? 'Contando…' : 'Ver qué traería'}</button
					>
				</form>
				{#if preview && form && 'month' in form}
					<div class="mt-3 rounded-md bg-zinc-900 p-3 text-sm">
						<p>
							Desde {monthName(String(form.month))}: {preview.payments}
							{preview.payments === 1 ? 'pago' : 'pagos'}.
						</p>
						<ul class="mt-1 list-disc pl-5 text-zinc-300">
							<li>
								{preview.added} nuevos ({euros(preview.addedTotal)}), que entran como gastos.
							</li>
							<li>{preview.joined} ya estaban (ticket, factura o fijo): se juntan con ellos.</li>
							{#if preview.known}<li>{preview.known} ya se habían traído antes.</li>{/if}
						</ul>
						{#if preview.added || preview.joined}
							<form method="post" action="?/history" use:enhance={sending('history')} class="mt-3">
								<input type="hidden" name="month" value={form.month} />
								<button class={primary} disabled={busy !== null}
									>{busy === 'history' ? 'Trayendo…' : 'Traerlos'}</button
								>
							</form>
						{/if}
					</div>
				{/if}
				{#if imported}
					<p class="mt-3 text-sm text-amber-400">
						✓ {imported.added} gastos nuevos y {imported.joined} juntados con los que ya estaban.
					</p>
				{/if}
			</section>
		{/if}

		<section class={section}>
			<h2 class="mb-1 font-semibold">Desconectar</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Seilide olvida tu clave y deja de traer pagos. Lo que ya entró se queda en Dinero. La clave
				sigue viva en bunq hasta que la borres allí.
			</p>
			{#if confirmOff}
				<form
					method="post"
					action="?/disconnect"
					use:enhance={sending('disconnect')}
					class="flex gap-2"
				>
					<button class="{primary} bg-red-700 text-claro hover:bg-red-600" disabled={busy !== null}
						>Sí, desconectar bunq</button
					>
					<button type="button" class={secondary} onclick={() => (confirmOff = false)}
						>Cancelar</button
					>
				</form>
			{:else}
				<button type="button" class={secondary} onclick={() => (confirmOff = true)}
					>Desconectar bunq</button
				>
			{/if}
		</section>
	{/if}
</div>
