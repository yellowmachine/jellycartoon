<script lang="ts">
	import { MAX_LABEL } from '#lib/walk-share.ts';

	/**
	 * A walk shared by link (#434): a new link with the photos chosen and its ends hidden unless
	 * said, sent from the phone's own menu (WhatsApp…) or copied; and its links, each «Retirar».
	 */
	let { walkId, photos }: { walkId: number; photos: { id: number }[] } = $props();

	interface Link {
		id: number;
		label: string | null;
		photos: number[];
		trim: boolean;
		createdAt: string;
		opens: number;
		lastOpenedAt: string | null;
		revokedAt: string | null;
	}

	const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
	const when = new Intl.DateTimeFormat('es', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	let links = $state<Link[]>([]);
	let open = $state(false);
	let label = $state('');
	let trim = $state(true);
	/** The photos left out: all go, unless taken out. */
	let left = $state(new Set<number>());
	let making = $state(false);
	let problem = $state<string | null>(null);
	/** The link just made: shown now only, as only its hash is kept. */
	let made = $state<string | null>(null);
	let copied = $state(false);
	/** «Retirar», asked twice, without a dialog. */
	let sure = $state<number | null>(null);
	const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

	async function load() {
		const res = await fetch(`/paseos/${walkId}/enlaces`).catch(() => null);
		if (res?.ok) links = await res.json();
	}
	$effect(() => {
		void walkId;
		void load();
	});

	async function create() {
		making = true;
		problem = null;
		const res = await fetch(`/paseos/${walkId}/enlaces`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				label: label.trim() || null,
				trim,
				photoIds: photos.map((p) => p.id).filter((id) => !left.has(id))
			})
		}).catch(() => null);
		making = false;
		if (!res?.ok) {
			problem = res
				? ((await res.json().catch(() => null))?.message ?? 'No se pudo crear el enlace')
				: 'Sin conexión';
			return;
		}
		made = (await res.json()).url;
		open = false;
		label = '';
		left = new Set();
		await load();
	}

	async function send() {
		if (!made) return;
		await navigator.share({ title: 'Mi paseo', url: made }).catch(() => {});
	}

	async function copy() {
		if (!made) return;
		await navigator.clipboard.writeText(made);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	async function revoke(id: number) {
		sure = null;
		const res = await fetch(`/paseos/enlaces/${id}`, { method: 'DELETE' }).catch(() => null);
		if (res?.ok) await load();
	}

	function toggle(id: number) {
		const next = new Set(left);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		left = next;
	}
</script>

<div class="mt-4 rounded-md border border-zinc-800 p-3">
	<div class="flex flex-wrap items-center gap-3">
		<button
			class="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
			onclick={() => {
				open = !open;
				made = null;
				problem = null;
			}}>{open ? 'Cancelar' : 'Compartir'}</button
		>
		<a href="/paseos/compartidos" class="text-sm text-zinc-400 hover:text-amber-300"
			>Mis paseos compartidos</a
		>
	</div>

	{#if open}
		<div class="mt-3 flex flex-col gap-3 text-sm">
			<label class="flex flex-col gap-1 text-zinc-400">
				Para quién (solo lo ves tú)
				<input
					bind:value={label}
					maxlength={MAX_LABEL}
					placeholder="Grupo del cole, Mamá…"
					class="rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:ring-amber-500"
				/>
			</label>
			<label class="flex items-start gap-2">
				<input type="checkbox" bind:checked={trim} class="mt-0.5 rounded" />
				<span>
					Sin el principio ni el final del recorrido
					<span class="block text-xs text-zinc-500">
						Unos 250 m alrededor de donde empezó y acabó, que suele ser casa, y las fotos hechas
						ahí.
					</span>
				</span>
			</label>
			{#if photos.length}
				<div>
					<p class="mb-1 text-zinc-400">
						Fotos: {photos.length - left.size} de {photos.length} (toca para quitar o poner)
					</p>
					<div class="grid grid-cols-4 gap-2">
						{#each photos as p (p.id)}
							<button
								class={['relative', left.has(p.id) && 'opacity-30']}
								aria-pressed={!left.has(p.id)}
								aria-label={left.has(p.id) ? 'Poner esta foto' : 'Quitar esta foto'}
								onclick={() => toggle(p.id)}
							>
								<img
									src="/paseos/fotos/{p.id}"
									alt=""
									loading="lazy"
									class="aspect-square w-full rounded object-cover"
								/>
								{#if !left.has(p.id)}
									<span
										class="absolute top-1 right-1 rounded-full bg-amber-500 px-1.5 text-xs text-zinc-950"
										>✓</span
									>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
			<p class="text-xs text-zinc-500">
				Quien tenga el enlace verá el mapa, los km, el tiempo y estas fotos, sin cuenta; las notas y
				la hora de cada punto, no. Puede reenviarlo o hacer una captura: retirarlo corta el enlace,
				no las copias.
			</p>
			<div>
				<button
					class="rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50"
					disabled={making}
					onclick={create}>{making ? 'Creando…' : 'Crear enlace'}</button
				>
			</div>
			{#if problem}<p class="text-amber-300" role="alert">{problem}</p>{/if}
		</div>
	{/if}

	{#if made}
		<div class="mt-3 flex flex-col gap-2 text-sm">
			<input
				readonly
				value={made}
				class="rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-xs text-zinc-300"
				onfocus={(e) => e.currentTarget.select()}
			/>
			<div class="flex flex-wrap gap-3">
				{#if canShare}
					<button
						class="rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950"
						onclick={send}>Enviar…</button
					>
				{/if}
				<button class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700" onclick={copy}
					>{copied ? 'Copiado' : 'Copiar enlace'}</button
				>
			</div>
			<p class="text-xs text-zinc-500">
				El enlace solo se enseña ahora. Si lo pierdes, retíralo y crea otro.
			</p>
		</div>
	{/if}

	{#if links.length}
		<ul class="mt-3 flex flex-col gap-2 text-sm">
			{#each links as l (l.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1">
					<span class={['min-w-0 flex-1', l.revokedAt && 'text-zinc-500 line-through']}>
						{l.label ?? 'Sin nombre'} · {day.format(new Date(l.createdAt))} ·
						{l.opens === 1 ? 'abierto 1 vez' : `abierto ${l.opens} veces`}{l.lastOpenedAt
							? `, la última el ${when.format(new Date(l.lastOpenedAt))}`
							: ''}
					</span>
					{#if l.revokedAt}
						<span class="text-xs text-zinc-500">Retirado</span>
					{:else if sure === l.id}
						<span class="text-red-300">¿Retirarlo?</span>
						<button class="text-red-400" onclick={() => revoke(l.id)}>Sí, retirar</button>
						<button class="text-zinc-400" onclick={() => (sure = null)}>No</button>
					{:else}
						<button class="text-zinc-500 hover:text-red-400" onclick={() => (sure = l.id)}
							>Retirar</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
