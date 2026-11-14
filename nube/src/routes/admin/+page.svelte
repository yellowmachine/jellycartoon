<script lang="ts">
	import { section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * The service's administrator's page, as svelte-thinking's /admin: how many families and people,
	 * the last day each one came in,
	 * how each night's copy of the VPS's apps went (deploy/vps-backup.sh, #320), and the waiting list
	 * and the apps.
	 */
	let { data }: PageProps = $props();

	const when = (d: Date) =>
		d.toLocaleString('es-ES', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	/** «hoy», «ayer», «hace 5 días». */
	const ago = (days: number | null) =>
		days === null
			? 'Nunca, o hace más de un mes'
			: days <= 0
				? 'Hoy'
				: days === 1
					? 'Ayer'
					: `Hace ${days} días`;
	const card = section.replace('mb-8 ', '');
	const link = `${card} block transition-colors hover:border-amber-400`;
	let open = $state<string | null>(null);
</script>

<svelte:head>
	<title>Admin · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-1 text-2xl font-bold">Admin</h1>
	<p class="mb-6 text-sm text-zinc-400">Cómo va el servicio.</p>

	<div class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class={card}>
			<p class="text-xs text-zinc-400 uppercase">Familias</p>
			<p class="text-2xl font-bold">{data.counts.families}</p>
		</div>
		<div class={card}>
			<p class="text-xs text-zinc-400 uppercase">Con casa</p>
			<p class="text-2xl font-bold">{data.counts.houses}</p>
		</div>
		<div class={card}>
			<p class="text-xs text-zinc-400 uppercase">Cuentas</p>
			<p class="text-2xl font-bold">{data.counts.users}</p>
		</div>
		<div class={card}>
			<p class="text-xs text-zinc-400 uppercase">Activas</p>
			<p class="text-2xl font-bold">
				{data.counts.active}
				<span class="text-sm font-normal text-zinc-400">{data.activeDays} días</span>
			</p>
		</div>
	</div>

	<h2 class="mb-1 text-lg font-semibold">Última vez</h2>
	<p class="mb-2 text-sm text-zinc-400">
		Cuándo entró cada cuenta por última vez, desde dónde y qué secciones ha abierto en los últimos
		{data.usageDays} días (cada una cuenta una vez cada media hora). Nunca qué hizo dentro.
	</p>
	<ul class="mb-8 divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.lastSeen as p (p.id)}
			<li class="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
				<span class="min-w-0">
					<span class="block truncate">{p.name}</span>
					<span class="block truncate text-xs text-zinc-500">{p.email}</span>
					{#if p.sections.length}
						<span class="mt-0.5 block text-xs text-zinc-400">
							{p.sections.map((s) => `${s.label} ${s.visits}`).join(' · ')}
						</span>
					{/if}
				</span>
				<span class="shrink-0 text-right">
					<span
						class={[
							'block',
							p.daysAgo === null || p.daysAgo > 7
								? 'text-zinc-500'
								: p.daysAgo <= 1 && 'text-amber-400'
						]}
						>{ago(p.daysAgo)}{#if p.at}, {p.at.toLocaleTimeString('es-ES', {
								hour: '2-digit',
								minute: '2-digit',
								timeZone: 'Europe/Madrid'
							})}{/if}</span
					>
					{#if p.device}<span class="block text-xs text-zinc-500">{p.device}</span>{/if}
				</span>
			</li>
		{/each}
	</ul>

	<h2 class="mb-2 text-lg font-semibold">Copias</h2>
	{#if !data.backups.length}
		<p class="mb-8 text-sm text-zinc-400">
			Ninguna copia ha avisado todavía. Hace falta BACKUP_REPORT_TOKEN aquí y en
			<code>/etc/vps-backup.env</code> del VPS, con BACKUP_REPORT_URL.
		</p>
	{:else}
		<ul class="mb-8 space-y-3">
			{#each data.backups as app (app.name)}
				<li class="{card} {app.alarm ? 'border-red-800' : ''}">
					<button
						class="flex w-full flex-wrap items-baseline gap-x-2 text-left"
						onclick={() => (open = open === app.name ? null : app.name)}
					>
						<span class={app.alarm ? 'text-red-400' : 'text-emerald-400'}>
							{app.alarm ? '✗' : '✓'}
						</span>
						<strong class="capitalize">{app.name}</strong>
						<span class="ml-auto text-sm text-zinc-400">
							{#if !app.runs[0].ok}
								Falló el {when(app.runs[0].createdAt)}
							{:else if app.alarm}
								Sin copia desde hace más de {data.lateHours} h
							{:else}
								{when(app.runs[0].createdAt)}
							{/if}
						</span>
					</button>
					{#if app.alarm && app.lastOk}
						<p class="mt-1 text-xs text-zinc-500">Última buena: {when(app.lastOk.createdAt)}</p>
					{/if}
					{#if open === app.name}
						<ul class="mt-3 space-y-2">
							{#each app.runs as run (run.createdAt)}
								<li>
									<p class="text-xs {run.ok ? 'text-zinc-400' : 'text-red-400'}">
										{run.ok ? '✓' : '✗'}
										{when(run.createdAt)}
									</p>
									<pre
										class="mt-1 overflow-x-auto rounded bg-zinc-900 p-2 text-xs whitespace-pre-wrap text-zinc-300">{run.log ||
											'(sin salida)'}</pre>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<a href="/admin/lista-de-espera" class={link}>
			<p class="text-xs text-zinc-400 uppercase">Lista de espera</p>
			<p class="text-2xl font-bold">
				{data.counts.waiting}
				<span class="text-sm font-normal text-zinc-400">esperando</span>
			</p>
		</a>
		<a href="/admin/espacio" class={link}>
			<p class="text-xs text-zinc-400 uppercase">Espacio</p>
			<p class="text-sm text-zinc-400">Lo que guarda cada familia, y su cuota.</p>
		</a>
		<a href="/admin/apps" class={link}>
			<p class="text-xs text-zinc-400 uppercase">Apps</p>
			<p class="text-sm text-zinc-400">Las que entran con la cuenta de Seilide.</p>
		</a>
	</div>
</div>
