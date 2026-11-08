<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import {
		energyText,
		euroText,
		MAX_ON_HOURS,
		MAX_PLUG_NAME,
		PLUG_KINDS,
		powerText,
		type FoundPlugView,
		type PlugKind,
		type PlugView
	} from '#lib/plugs.ts';
	import { field, primary, secondary, section, select } from '#lib/styles.ts';
	import { MAX_SCHEDULES, scheduleText, WEEK } from '#lib/plug-schedules.ts';
	import type { PageProps } from './$types';

	/**
	 * Enchufes (#396): a big button per plug, what it uses now, today and this month, and how to
	 * connect a new one: found and set up by a satellite, or its address pasted into its own page.
	 */
	let { data, form }: PageProps = $props();

	let live = $state<PlugView[] | null>(null);
	const plugs = $derived(live ?? data.plugs);
	$effect(() => {
		const events = new EventSource('/api/enchufes/events');
		events.onmessage = (e) => (live = JSON.parse(e.data));
		return () => events.close();
	});

	/** The one being sent an order, and the one being changed. */
	let busy = $state<string | null>(null);
	let editing = $state<string | null>(null);
	let copied = $state(false);
	/** «Buscar enchufes» (#396): what the satellites found, and the one being set up. */
	type Search = { found: FoundPlugView[]; silent: string[]; satellites: number };
	let found = $state<Search | null>(null);
	let searching = $state(false);
	let adding = $state<string | null>(null);
	/** The plug whose «Añadir horario» is open. */
	let scheduling = $state<string | null>(null);

	const euros = (wh: number) => (data.price === null ? null : euroText((wh / 1000) * data.price));
	const priceText = $derived(
		data.price === null ? '' : data.price.toLocaleString('es-ES', { maximumFractionDigits: 4 })
	);
	const hourFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });

	const kinds = Object.entries(PLUG_KINDS) as [PlugKind, { label: string; icon: string }][];

	const seenFormat = new Intl.DateTimeFormat('es', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	function stateText(p: PlugView) {
		if (p.waiting) return 'Sin conectar todavía';
		if (p.paused) return 'En pausa';
		if (p.heatUntil && p.online)
			return `Calentando hasta las ${hourFormat.format(new Date(p.heatUntil))}`;
		if (!p.online)
			return p.lastSeenAt
				? `Sin conexión desde el ${seenFormat.format(new Date(p.lastSeenAt))}`
				: 'Sin conexión';
		return p.output ? 'Encendido' : 'Apagado';
	}

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Not allowed: it can still be selected by hand.
		}
	}
</script>

<svelte:head>
	<title>Enchufes · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Enchufes</h1>
<p class="mb-6 text-sm text-zinc-400">
	Enciende y apaga los aparatos desde donde estés, y mira cuánto gastan. Funciona con enchufes
	Shelly, sin instalar nada en casa.
</p>

{#if form && 'problem' in form && form.problem}
	<p class="mb-4 rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">{form.problem}</p>
{/if}

{#if form && 'address' in form && form.address}
	{@const a = form.address}
	<section class="{section} border-amber-500/50">
		<h2 class="mb-2 font-semibold">Conecta el enchufe</h2>
		<p class="mb-2 text-sm text-zinc-300">
			Esta es su dirección. Solo se enseña ahora; si la pierdes, pide otra.
		</p>
		<div class="mb-4 flex gap-2">
			<input readonly value={a.url} class="{field} min-w-0 flex-1 font-mono text-xs" />
			<button type="button" class={primary} onclick={() => copy(a.url)}>
				{copied ? '✓ Copiada' : 'Copiar'}
			</button>
		</div>
		<ol class="mb-4 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
			<li>
				Con el móvil en la wifi de casa, abre la página del enchufe: escribe su IP en el navegador
				(la ves en la app del router o en la app Shelly).
			</li>
			<li>
				Entra en <strong>Settings → Outbound WebSocket</strong>, activa <em>Enable</em>, pega la
				dirección en <em>Server</em> y guarda.
			</li>
			<li>
				Te pedirá reiniciarlo: dale a <strong>Reboot</strong>. En unos segundos sale aquí como
				conectado.
			</li>
		</ol>
		<p class="text-sm text-zinc-400">
			Consejo: ponle contraseña en <strong>Settings → Authentication</strong>. Sin ella, cualquiera
			en la wifi de casa puede encenderlo y apagarlo. A Seilide no le afecta.
		</p>
		{#if a.kind === 'termo'}
			<p class="mt-3 rounded-md bg-amber-950/60 px-3 py-2 text-sm text-amber-200">
				Un termo gasta mucho para un enchufe, y puede calentarlo o hacer saltar los automáticos. Lo
				seguro es un relé Shelly instalado por un electricista en el cuadro o junto al termo.
			</p>
		{/if}
	</section>
{/if}

{#if plugs.length}
	<ul class="mb-8 grid gap-4 sm:grid-cols-2">
		{#each plugs as p (p.id)}
			{@const on = p.online && p.output === true}
			<li
				class="rounded-xl border p-4 {on
					? 'border-amber-500/60 bg-amber-500/10'
					: 'border-zinc-800 bg-zinc-900/40'}"
			>
				<form
					method="post"
					action="?/switch"
					use:enhance={() => {
						busy = p.id;
						return async ({ update }) => {
							await update();
							busy = null;
						};
					}}
				>
					<input type="hidden" name="id" value={p.id} />
					<input type="hidden" name="on" value={String(!on)} />
					<button
						disabled={!p.online || p.paused || busy === p.id}
						class="flex w-full items-center gap-4 rounded-lg text-left disabled:cursor-not-allowed"
						aria-label="{on ? 'Apagar' : 'Encender'} {p.name}"
					>
						<span class="text-4xl {on ? '' : 'opacity-60 grayscale'}" aria-hidden="true"
							>{PLUG_KINDS[p.kind].icon}</span
						>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-lg font-semibold">{p.name}</span>
							<span class="block text-sm {p.online ? 'text-zinc-300' : 'text-zinc-500'}"
								>{stateText(p)}</span
							>
						</span>
						{#if p.online && !p.paused}
							<span
								class="shrink-0 rounded-full px-4 py-2 text-sm font-semibold {on
									? 'bg-amber-500 text-zinc-950'
									: 'bg-zinc-800 text-zinc-200'}"
							>
								{busy === p.id ? '…' : on ? 'Apagar' : 'Encender'}
							</span>
						{/if}
					</button>
				</form>
				{#if form && 'switchProblem' in form && form.switchProblem === p.id}
					<p class="mt-2 text-sm text-red-300">{form.problem}</p>
				{/if}

				{#if !p.waiting}
					<dl class="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
						<div>
							<dt class="text-xs text-zinc-500">Ahora</dt>
							<dd>{p.power === null ? '—' : powerText(p.power)}</dd>
						</div>
						<div>
							<dt class="text-xs text-zinc-500">Hoy</dt>
							<dd>{energyText(p.todayWh)}</dd>
							{#if euros(p.todayWh)}<dd class="text-xs text-zinc-400">{euros(p.todayWh)}</dd>{/if}
						</div>
						<div>
							<dt class="text-xs text-zinc-500">Este mes</dt>
							<dd>{energyText(p.monthWh)}</dd>
							{#if euros(p.monthWh)}<dd class="text-xs text-zinc-400">{euros(p.monthWh)}</dd>{/if}
						</div>
					</dl>

					<div class="mt-4 border-t border-zinc-800 pt-3 text-sm">
						{#if p.schedules.length}
							<ul class="mb-2 space-y-1">
								{#each p.schedules as sch (sch.id)}
									<li class="flex items-center gap-2">
										<span class="min-w-0 flex-1 {p.paused ? 'text-zinc-500 line-through' : ''}"
											>⏰ {scheduleText(sch)}</span
										>
										<form method="post" action="?/unschedule" use:enhance>
											<input type="hidden" name="id" value={p.id} />
											<input type="hidden" name="scheduleId" value={sch.id} />
											<button
												class="px-2 text-zinc-500 hover:text-red-400"
												aria-label="Quitar el horario {scheduleText(sch)}">✕</button
											>
										</form>
									</li>
								{/each}
							</ul>
						{/if}
						{#if scheduling === p.id}
							<form
								method="post"
								action="?/schedule"
								use:enhance={() =>
									async ({ result, update }) => {
										if (result.type === 'success') scheduling = null;
										await update();
									}}
								class="space-y-3"
							>
								<input type="hidden" name="id" value={p.id} />
								<fieldset class="flex flex-wrap gap-1">
									<legend class="sr-only">Días</legend>
									{#each WEEK as w (w.day)}
										<label class="cursor-pointer">
											<input
												type="checkbox"
												name="days"
												value={w.day}
												checked
												class="peer sr-only"
											/>
											<span
												title={w.name}
												class="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-sm peer-checked:bg-amber-500 peer-checked:font-semibold peer-checked:text-zinc-950 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400"
												>{w.short}</span
											>
										</label>
									{/each}
								</fieldset>
								<div class="flex flex-wrap items-center gap-2">
									<label class="flex items-center gap-2 whitespace-nowrap"
										>Enciende a las
										<input
											type="time"
											name="start"
											required
											value="07:00"
											class="{field} w-auto py-1"
										/></label
									>
									<label class="flex items-center gap-2 whitespace-nowrap"
										>y apaga a las
										<input
											type="time"
											name="end"
											required
											value="08:00"
											class="{field} w-auto py-1"
										/></label
									>
								</div>
								{#if form && 'scheduleProblem' in form && form.scheduleProblem === p.id}
									<p class="text-red-300">{form.problem}</p>
								{/if}
								<div class="flex gap-2">
									<button class={primary}>Guardar</button>
									<button type="button" class={secondary} onclick={() => (scheduling = null)}
										>Cancelar</button
									>
								</div>
							</form>
						{:else if p.schedules.length < MAX_SCHEDULES}
							<button
								class="text-amber-400 hover:text-amber-300"
								onclick={() => (scheduling = p.id)}>＋ Añadir horario</button
							>
						{/if}

						{#if p.kind === 'termo'}
							<form
								method="post"
								action="?/pause"
								use:enhance
								class="mt-3 flex flex-wrap items-center gap-3"
							>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="paused" value={String(!p.paused)} />
								<button class={secondary}>{p.paused ? 'Quitar la pausa' : 'Poner en pausa'}</button>
								<span class="text-xs text-zinc-500"
									>{p.paused
										? 'Apagado y sin horarios hasta que la quites.'
										: 'Para el verano o las vacaciones: apagado y sin horarios.'}</span
								>
							</form>
							{#if form && 'pausedId' in form && form.pausedId === p.id && form.heats}
								<p class="mt-2 rounded-md bg-amber-950/60 px-3 py-2 text-amber-200">
									Ha pasado mucho tiempo parado: se calienta 4 horas seguidas contra la legionela, y
									luego vuelven los horarios. Para que sirva, el termostato del termo tiene que
									estar a 60 °C o más.
								</p>
							{/if}
						{/if}
					</div>
				{/if}

				{#if editing === p.id}
					<form
						method="post"
						action="?/save"
						use:enhance={() =>
							async ({ update }) => {
								editing = null;
								await update();
							}}
						class="mt-4 space-y-2"
					>
						<input type="hidden" name="id" value={p.id} />
						<input
							name="name"
							value={p.name}
							maxlength={MAX_PLUG_NAME}
							aria-label="Nombre"
							class={field}
						/>
						<select name="kind" value={p.kind} aria-label="Qué hay enchufado" class={select}>
							{#each kinds as [kind, k] (kind)}
								<option value={kind}>{k.icon} {k.label}</option>
							{/each}
						</select>
						<div class="flex flex-wrap gap-2">
							<button class={primary}>Guardar</button>
							<button type="button" class={secondary} onclick={() => (editing = null)}
								>Cancelar</button
							>
						</div>
					</form>
					<form
						method="post"
						action="?/notices"
						use:enhance={() =>
							async ({ update }) =>
								update({ reset: false })}
						class="mt-4 space-y-2 border-t border-zinc-800 pt-3 text-sm"
					>
						<input type="hidden" name="id" value={p.id} />
						<p class="font-medium">Avisos</p>
						<label class="flex items-center gap-2">
							<input type="checkbox" name="done" checked={p.notices.done} class="rounded" />
							Cuando acabe (lavadora, lavavajillas…)
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" name="stopped" checked={p.notices.stopped} class="rounded" />
							Si deja de funcionar 3 horas (nevera, congelador)
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" name="offline" checked={p.notices.offline} class="rounded" />
							Si se queda sin conexión media hora (luz o wifi)
						</label>
						<label class="flex flex-wrap items-center gap-2">
							<input
								type="checkbox"
								name="longOn"
								checked={p.notices.onHours !== null}
								class="rounded"
							/>
							Si lleva encendido más de
							<input
								type="number"
								name="onHours"
								min="1"
								max={MAX_ON_HOURS}
								value={p.notices.onHours ?? 1}
								aria-label="Horas"
								class="w-16 rounded-md border-zinc-700 bg-zinc-900 py-0.5 text-zinc-100"
							/>
							h
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" name="aloud" checked={p.notices.aloud} class="rounded" />
							Decirlo también en casa, por los altavoces
						</label>
						{#if form && 'noticesProblem' in form && form.noticesProblem === p.id}
							<p class="text-red-300">{form.problem}</p>
						{/if}
						<div class="flex items-center gap-3">
							<button class={secondary}>Guardar avisos</button>
							{#if form && 'noticesSaved' in form && form.noticesSaved === p.id}
								<span class="text-emerald-300">✓ Guardado</span>
							{/if}
						</div>
						<p class="text-xs text-zinc-500">
							Llegan al Buzón y al móvil de los adultos de la familia.
						</p>
					</form>
					<div class="mt-4 flex flex-wrap items-center gap-4 border-t border-zinc-800 pt-3">
						<ConfirmForm
							action="?/renew"
							fields={{ id: p.id, kind: p.kind }}
							label="Nueva dirección"
							question="¿Darle una dirección nueva? La de ahora deja de valer y hay que pegar la nueva en el enchufe."
							yes="Sí, nueva"
							class="text-sm text-zinc-400 hover:text-white"
						/>
						<ConfirmForm
							action="?/remove"
							fields={{ id: p.id }}
							label="Quitar"
							question="¿Quitar este enchufe? Se pierde lo que ha gastado. Si está conectado, se le dice que deje de conectarse."
							yes="Sí, quitar"
							class="text-sm text-zinc-500 hover:text-red-400"
						/>
					</div>
				{:else}
					<div class="mt-3 flex items-center justify-end gap-3 text-sm">
						{#if p.waiting}
							<ConfirmForm
								action="?/renew"
								fields={{ id: p.id, kind: p.kind }}
								label="Ver cómo conectarlo"
								question="Para verlo otra vez hace falta una dirección nueva; la anterior deja de valer. ¿Seguimos?"
								yes="Sí"
								class="text-amber-400 hover:text-amber-300"
							/>
						{/if}
						<button class="text-zinc-400 hover:text-white" onclick={() => (editing = p.id)}
							>Cambiar</button
						>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if plugs.length}
	<form
		method="post"
		action="?/price"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		class="mb-8 flex flex-wrap items-center gap-2 text-sm"
	>
		<label for="precio" class="text-zinc-400">Precio del kWh</label>
		<input
			id="precio"
			name="price"
			inputmode="decimal"
			value={priceText}
			placeholder="0,15"
			class="w-24 rounded-md border-zinc-700 bg-zinc-900 py-1 text-zinc-100 focus:border-amber-400 focus:ring-amber-400"
		/>
		<span class="text-zinc-400">€</span>
		<button class={secondary}>Guardar</button>
		{#if form && 'priced' in form}<span class="text-emerald-300">✓ Guardado</span>{/if}
	</form>
{/if}

{#snippet byHand()}
	<form method="post" action="?/add" use:enhance class="space-y-2">
		<input
			name="name"
			maxlength={MAX_PLUG_NAME}
			placeholder="Su nombre: «Lámpara del salón», «Lavadora»…"
			aria-label="Nombre"
			class={field}
		/>
		<div class="flex flex-wrap items-center gap-2">
			<select name="kind" aria-label="Qué hay enchufado" class={select}>
				{#each kinds as [kind, k] (kind)}
					<option value={kind}>{k.icon} {k.label}</option>
				{/each}
			</select>
			<button class={primary}>Añadir</button>
		</div>
	</form>
{/snippet}

{#if data.satellites}
	<section class={section}>
		<h2 class="mb-1 font-semibold">{plugs.length ? 'Añadir otro enchufe' : 'Añadir un enchufe'}</h2>
		<p class="mb-3 text-sm text-zinc-400">
			{data.satellites === 1 ? 'El satélite busca' : 'Los satélites buscan'} los enchufes Shelly de la
			wifi de casa y los deja conectados a Seilide.
		</p>
		<form
			method="post"
			action="?/search"
			use:enhance={() => {
				searching = true;
				return async ({ result }) => {
					searching = false;
					if (result.type === 'success') found = (result.data?.search as Search) ?? null;
				};
			}}
		>
			<button class={primary} disabled={searching}>
				{searching ? 'Buscando… (unos segundos)' : '🔎 Buscar enchufes'}
			</button>
		</form>

		{#if found}
			{#if found.silent.length}
				<p class="mt-3 text-sm text-amber-300">
					No contesta: {found.silent.join(', ')}. Puede que esté apagado o sin actualizar.
				</p>
			{/if}
			{#if !found.found.length}
				<p class="mt-3 text-sm text-zinc-400">
					No se ve ningún enchufe Shelly. Comprueba que está enchufado y en la wifi de casa.
				</p>
			{:else}
				<ul class="mt-4 space-y-3">
					{#each found.found as f (f.deviceId)}
						<li class="rounded-md border border-zinc-800 p-3">
							<p class="text-sm">
								<span class="font-medium">Shelly {f.model}</span>
								<span class="text-zinc-500">· {f.deviceId.slice(-6)} · {f.ip}</span>
							</p>
							{#if f.added}
								<p class="mt-1 text-sm text-zinc-400">Ya está: {f.added}</p>
							{:else if f.auth}
								<p class="mt-1 text-sm text-zinc-400">
									Tiene contraseña: quítasela un momento en su página y busca otra vez, o conéctalo
									a mano.
								</p>
							{:else}
								{#if f.elsewhere}
									<p class="mt-1 text-sm text-amber-300">
										Ya se conecta a otro sitio: si lo añades, pasa a conectarse a Seilide.
									</p>
								{/if}
								<form
									method="post"
									action="?/addFound"
									use:enhance={() => {
										adding = f.deviceId;
										return async ({ result, update }) => {
											adding = null;
											if (result.type === 'success' && found)
												found = {
													...found,
													found: found.found.map((x) =>
														x.deviceId === f.deviceId ? { ...x, added: 'añadido ahora' } : x
													)
												};
											await update();
										};
									}}
									class="mt-2 space-y-2"
								>
									<input type="hidden" name="satelliteId" value={f.satelliteId} />
									<input type="hidden" name="deviceId" value={f.deviceId} />
									<input type="hidden" name="ip" value={f.ip} />
									<input
										name="name"
										maxlength={MAX_PLUG_NAME}
										placeholder="Su nombre: «Lámpara del salón»…"
										aria-label="Nombre"
										class={field}
									/>
									<div class="flex flex-wrap items-center gap-2">
										<select name="kind" aria-label="Qué hay enchufado" class={select}>
											{#each kinds as [kind, k] (kind)}
												<option value={kind}>{k.icon} {k.label}</option>
											{/each}
										</select>
										<button class={primary} disabled={adding !== null}>
											{adding === f.deviceId ? 'Conectando…' : 'Añadir'}
										</button>
									</div>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if form && 'connecting' in form && form.connecting}
			<p class="mt-3 text-sm text-emerald-300">
				Listo: el enchufe se está reiniciando y sale conectado en unos segundos.
			</p>
		{/if}

		<details class="mt-4 text-sm">
			<summary class="cursor-pointer text-zinc-400">Añadirlo a mano, con su dirección</summary>
			<div class="mt-3">{@render byHand()}</div>
		</details>
	</section>
{:else}
	<section class={section}>
		<h2 class="mb-3 font-semibold">{plugs.length ? 'Añadir otro enchufe' : 'Añadir un enchufe'}</h2>
		{@render byHand()}
	</section>
{/if}
