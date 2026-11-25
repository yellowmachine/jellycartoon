<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { euros } from 'comun/expenses.ts';
	import { FUEL_KINDS, MIN_UNITS, WINTER_DEGREES } from '#lib/fuel.ts';
	import type { FuelState } from '#lib/server/energy/fuel.ts';

	/**
	 * Butane or pellet (Energía → Previsión, #513 phase 2): what is at home, how long it lasts with
	 * the cold to come, the expenses in Dinero that look like a purchase, its history and settings.
	 * Several may be going, each in its spot (#628); with only one, the spot is not named.
	 */
	let {
		f,
		today,
		done,
		problem
	}: {
		f: FuelState;
		today: string;
		/** What was just done here, and what undoes it. */
		done: { text: string | null; undo: unknown } | null;
		/** Why it could not be. */
		problem: string | null;
	} = $props();
	const meta = $derived(FUEL_KINDS[f.kind]);
	const o = $derived(f.outlook);
	const many = $derived(f.spots.length > 1);
	const only = $derived(f.spots.length === 1 ? f.spots[0]! : null);
	/** «una bombona», «un saco», and what agrees with them. */
	const fem = $derived(f.kind === 'butano');
	const the = $derived(fem ? 'La' : 'El');
	const one = $derived(fem ? 'una' : 'uno');

	const dayName = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'long',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const daysBetween = (a: string, b: string) =>
		Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
	const plural = (n: number) => (n === 1 ? meta.unit : meta.units);
	const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');
	/** «unas 2 bombonas (entre 1 y 3)», or one figure when the range is no range. */
	function neededText(n: { kwh: number; low: number; high: number }) {
		const [mid, low, high] = [n.kwh, n.low, n.high].map((x) => Math.max(0, Math.round(x)));
		if (!high) return 'casi nada';
		const some = (k: number) =>
			k <= 1 ? `${fem ? 'una' : 'un'} ${meta.unit}` : `${fem ? 'unas' : 'unos'} ${k} ${meta.units}`;
		return low === high ? some(low) : `${some(mid)} (entre ${low} y ${high})`;
	}
	/** What the next days take, at the last price; whole euros are enough. */
	const needCost = $derived(
		o && f.unitCost !== null && Math.round(o.needed.kwh * 10)
			? (o.needed.kwh * f.unitCost) / 100
			: null
	);
	/** «18,50 €» as it is written in a box: «18,50». */
	const boxed = (cents: number | null) =>
		cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
	let settings = $state(false);
	let history = $state(false);
	let buying = $state(false);
	/** The unit or purchase of the history being put right. */
	let editing = $state<string | null>(null);
	const button =
		'rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800';
	const main = 'rounded-md bg-amber-600 px-3 py-1 text-sm text-zinc-950 hover:bg-amber-500';
	const input = 'rounded-md border-zinc-700 bg-zinc-950 py-1 text-sm';
	const small = 'text-xs text-zinc-500 hover:text-white';
	/** Kept as written if it could not be; closed when it could. */
	const closing =
		(close: () => void): import('$app/forms').SubmitFunction =>
		() =>
		async ({ update, result }) => {
			await update({ reset: result.type === 'success' });
			if (result.type === 'success') close();
		};
	const nothing = () => {};
</script>

{#snippet useSelect(units: { id: number; spot: string; startedOn: string }[])}
	<label class="flex max-w-full min-w-0 flex-wrap items-center gap-1 text-zinc-300">
		¿{fem ? 'La' : 'Lo'} has puesto?
		<select name="use" class="max-w-full min-w-0 {input}">
			{#each units as u (u.id)}
				<option value="unit:{u.id}"
					>Es {fem ? 'la' : 'el'} que empecé el {dayName(u.startedOn)}{many
						? ` (${u.spot})`
						: ''}</option
				>
			{/each}
			{#each f.spots as s, i (s.id)}
				<option value="spot:{s.id}" selected={!units.length && f.startsOnBuy && !many && i === 0}
					>{many ? `Sí, en ${s.name}` : 'Sí, ese día'}</option
				>
			{/each}
			<option value="" selected={!units.length && (many || !f.startsOnBuy)}
				>No, está llen{fem ? 'a' : 'o'}</option
			>
		</select>
	</label>
{/snippet}

<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
	<div class="flex items-baseline justify-between gap-2">
		<h3 class="font-semibold">{meta.icon} {meta.name}</h3>
		<button class={small} aria-expanded={settings} onclick={() => (settings = !settings)}
			>{settings ? 'Cerrar' : 'Ajustes'}</button
		>
	</div>

	<div role="status" aria-live="polite">
		{#if done?.text}
			<div
				class="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm"
			>
				<span>✓ {done.text}</span>
				{#if done.undo}
					<form method="post" action="?/undoFuel" use:enhance>
						<input type="hidden" name="fuel" value={f.id} />
						<input type="hidden" name="undo" value={JSON.stringify(done.undo)} />
						<button class="text-amber-400 hover:underline">Deshacer</button>
					</form>
				{/if}
			</div>
		{/if}
	</div>
	{#if problem}
		<p
			class="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300"
			role="alert"
		>
			{problem}.
		</p>
	{/if}

	{#if o}
		<p class="mt-2 text-lg font-semibold text-zinc-100">
			{#if o.allEnds}
				{f.full || many ? 'Lo que hay en casa llega' : 'Te llega'} hasta el {dayName(o.allEnds)}
			{:else}
				Te llega para más de dos semanas
			{/if}
		</p>
		<p class="text-sm text-zinc-400">
			En los próximos 15 días, {neededText(o.needed)}{#if o.toBuy}; {f.startsOnBuy
					? 'tendrás que pedir'
					: 'compra'}
				{o.toBuy}
				{plural(o.toBuy)}{/if}{#if needCost !== null}. Al último precio, unos {euros(
					needCost
				)}{/if}.
			{#if f.uncounted.length}Sin contar {f.uncounted.join(', ')}: aún no sé cuánto dura.{/if}
		</p>
	{/if}
	<p class="mt-1 text-sm text-zinc-300">
		{f.full
			? `${f.full} ${fem ? (f.full === 1 ? 'llena' : 'llenas') : f.full === 1 ? 'lleno' : 'llenos'} en casa.`
			: `Ningun${fem ? 'a llena' : 'o lleno'} en casa, que yo sepa.`}
	</p>

	{#each f.spots as s (s.id)}
		<div class="mt-3 {many ? 'rounded-lg border border-zinc-800 p-3' : ''}">
			<p class="text-sm text-zinc-300">
				{#if many}<b>{s.name}</b>:{/if}
				{#if s.unit}
					{many ? 'empezad' + (fem ? 'a' : 'o') : `${the} de ahora, empezad${fem ? 'a' : 'o'}`} el
					{dayName(s.unit.startedOn)}{#if s.left !== null}. Le queda más o menos un {n0(
							s.left * 100
						)} %{#if s.ends}, hasta el {dayName(s.ends)}{/if}{/if}.
				{:else}
					No hay {fem ? 'ninguna puesta' : 'ninguno puesto'}, que yo sepa.
				{/if}
			</p>
			<p class="mt-1 text-xs text-zinc-500">
				{#if s.by === 'aprendido' && s.fit}
					Aprendido de {s.learnedFrom}
					{plural(s.learnedFrom)}: {s.heats
						? `con frío de invierno (${WINTER_DEGREES} grados-día) `
						: ''}dura unos {n0(1 / (s.fit.base + (s.heats ? s.fit.perDegree * WINTER_DEGREES : 0)))} días.
				{:else if s.by === 'dicho'}
					Con lo que dijiste (unos {s.guessDays} días{s.heats ? ' en invierno' : ''}) hasta que
					aprenda de {MIN_UNITS}
					{meta.units} enteras (llevas {s.learnedFrom}).
				{:else}
					Para calcularlo, dime en Ajustes cuánto dura{s.heats ? ' en invierno' : ''}, o espera a
					que aprenda de {MIN_UNITS}
					{meta.units} enteras (llevas {s.learnedFrom}).
				{/if}
			</p>
			{#if s.sums}
				<p class="mt-1 text-xs text-zinc-400">
					En el último año, {s.sums.units}
					{plural(s.sums.units)}{s.sums.units > 1
						? `, ${n0(s.sums.days)} días cada ${one} de media`
						: ` de ${n0(s.sums.days)} días`}{#if s.sums.perDay !== null}: {euros(s.sums.perDay)} al día{s
							.sums.priced < s.sums.units
							? ` (con precio, ${s.sums.priced})`
							: ''}{/if}.
				</p>
			{/if}
			<form
				method="post"
				action="?/started"
				use:enhance={closing(nothing)}
				class="mt-2 flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="fuel" value={f.id} />
				<input type="hidden" name="spot" value={s.id} />
				<input
					type="date"
					name="day"
					defaultValue={today}
					max={today}
					required
					aria-label="Qué día"
					class={input}
				/>
				<button class={button} name="id" value={f.id}
					>{s.unit ? `He puesto otr${fem ? 'a' : 'o'}` : `He empezado ${one}`}</button
				>
				{#if s.unit}
					<button class={button} formaction="?/ended" name="id" value={s.unit.id}
						>Se ha acabado</button
					>
				{/if}
			</form>
		</div>
	{/each}

	{#each f.pending as e (e.id)}
		<div class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<p>
				En Gastos, el {dayName(e.date)}: {e.store}, {e.total}. ¿Es {meta.unit === 'bombona'
					? 'una bombona'
					: 'pellet'}?
			</p>
			<form
				method="post"
				action="?/bought"
				use:enhance
				class="mt-2 flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="fuel" value={f.id} />
				<input type="hidden" name="id" value={f.id} />
				<input type="hidden" name="day" value={e.date} />
				<input type="hidden" name="expense" value={e.id} />
				<label class="flex items-center gap-1 text-zinc-300"
					>Sí,
					<input type="number" name="quantity" value="1" min="1" max="50" class="w-16 {input}" />
					{meta.units}</label
				>
				{@render useSelect(e.units)}
				<button class={main}>Apuntar</button>
			</form>
			<form method="post" action="?/bought" use:enhance class="mt-1">
				<input type="hidden" name="fuel" value={f.id} />
				<input type="hidden" name="id" value={f.id} />
				<input type="hidden" name="day" value={e.date} />
				<input type="hidden" name="expense" value={e.id} />
				<button
					name="quantity"
					value="0"
					class="rounded-md py-1 text-sm text-zinc-400 hover:text-white">No es</button
				>
			</form>
		</div>
	{/each}

	<div class="mt-3 flex flex-wrap gap-4">
		<button class={small} aria-expanded={buying} onclick={() => (buying = !buying)}
			>{buying ? 'Cerrar' : 'He comprado…'}</button
		>
		<button class={small} aria-expanded={history} onclick={() => (history = !history)}
			>{history ? 'Cerrar el historial' : 'Historial'}</button
		>
	</div>

	{#if buying}
		<form
			method="post"
			action="?/bought"
			use:enhance={closing(() => (buying = false))}
			class="mt-2 flex flex-wrap items-center gap-2 text-sm"
		>
			<input type="hidden" name="fuel" value={f.id} />
			<input type="hidden" name="id" value={f.id} />
			<input
				type="number"
				name="quantity"
				value="1"
				min="1"
				max="50"
				aria-label="Cuánt{fem ? 'a' : 'o'}s"
				class="w-16 {input}"
			/>
			{meta.units} el
			<input
				type="date"
				name="day"
				defaultValue={today}
				max={today}
				required
				aria-label="Qué día"
				class={input}
			/>
			<label class="flex items-center gap-1"
				>por
				<input name="price" inputmode="decimal" placeholder="opcional" class="w-24 {input}" />
				€</label
			>
			{@render useSelect([])}
			<button class={main}>Apuntar</button>
			<span class="text-xs text-zinc-500">Si está en Gastos, se ofrece solo: apúntalo allí.</span>
		</form>
	{/if}

	{#if history}
		<div class="mt-3 border-t border-zinc-800 pt-3 text-sm">
			<h4 class="text-xs text-zinc-500">Empezad{fem ? 'a' : 'o'}s</h4>
			{#each f.history.units as u (u.id)}
				<div class="border-b border-zinc-800/60 py-2">
					{#if editing === `u${u.id}`}
						<form
							method="post"
							action="?/editUnit"
							use:enhance={closing(() => (editing = null))}
							class="flex flex-wrap items-center gap-2"
						>
							<input type="hidden" name="fuel" value={f.id} />
							<input type="hidden" name="id" value={u.id} />
							<label class="flex items-center gap-1"
								>Del
								<input
									type="date"
									name="startedOn"
									defaultValue={u.startedOn}
									min={u.boughtOn}
									max={today}
									required
									class={input}
								/></label
							>
							<label class="flex items-center gap-1"
								>al
								<input
									type="date"
									name="endedOn"
									defaultValue={u.endedOn ?? ''}
									max={today}
									class={input}
								/></label
							>
							<label class="flex items-center gap-1"
								><input type="checkbox" name="whole" defaultChecked={u.whole} />Se gastó enter{fem
									? 'a'
									: 'o'}</label
							>
							<button class={main}>Guardar</button>
							<button type="button" class={small} onclick={() => (editing = null)}>Cancelar</button>
							<span class="w-full text-xs text-zinc-500">
								{#if u.boughtOn}Se compró el {dayName(u.boughtOn)}.{/if} Sin fecha final, sigue puest{fem
									? 'a'
									: 'o'}.
							</span>
						</form>
					{:else}
						<div class="flex flex-wrap items-baseline gap-x-3">
							<span>
								{#if many}<b>{u.spot}</b>,{/if}
								{dayName(u.startedOn)} → {u.endedOn ? dayName(u.endedOn) : 'ahora'}
								{#if u.endedOn}
									({n0(daysBetween(u.startedOn, u.endedOn))} días{u.whole
										? ''
										: ', a medias'}{u.cost !== null ? `, ${euros(u.cost)}` : ''}{u.perDay !== null
										? `, ${euros(u.perDay)} al día`
										: ''})
								{/if}
							</span>
							<button class={small} onclick={() => (editing = `u${u.id}`)}>Editar</button>
							<ConfirmForm
								action="?/removeUnit"
								fields={{ id: u.id, fuel: f.id }}
								label="Borrar"
								question="¿Borrar? Si la anterior acabó ese día, pasa a seguir hasta donde acababa esta."
								class="text-xs text-zinc-500 hover:text-red-400"
							/>
						</div>
					{/if}
				</div>
			{:else}
				<p class="py-1 text-zinc-500">Nada aún.</p>
			{/each}
			<h4 class="mt-3 text-xs text-zinc-500">
				Compras{#if f.spent}: {euros(f.spent.total)} en el último año{f.spent.unpriced
						? ` (${f.spent.unpriced} sin precio)`
						: ''}{/if}
			</h4>
			{#each f.history.purchases as p (p.id)}
				<div class="border-b border-zinc-800/60 py-2">
					{#if editing === `p${p.id}`}
						<form
							method="post"
							action="?/editPurchase"
							use:enhance={closing(() => (editing = null))}
							class="flex flex-wrap items-center gap-2"
						>
							<input type="hidden" name="fuel" value={f.id} />
							<input type="hidden" name="id" value={p.id} />
							<input
								type="number"
								name="quantity"
								defaultValue={p.quantity}
								min="1"
								max="50"
								aria-label="Cuánt{fem ? 'a' : 'o'}s"
								class="w-16 {input}"
							/>
							<input
								type="date"
								name="day"
								defaultValue={p.day}
								max={today}
								required
								aria-label="Qué día"
								class={input}
							/>
							<label class="flex items-center gap-1"
								>Precio
								<input
									name="price"
									inputmode="decimal"
									defaultValue={p.written ? boxed(p.cost) : ''}
									placeholder={p.written ? '' : boxed(p.cost)}
									class="w-20 {input}"
								/>
								€</label
							>
							{#if p.fromExpense}
								<span class="w-full text-xs text-zinc-500">Vacío, lo que diga su gasto.</span>
							{/if}
							<button class={main}>Guardar</button>
							<button type="button" class={small} onclick={() => (editing = null)}>Cancelar</button>
						</form>
					{:else}
						<div class="flex flex-wrap items-baseline gap-x-3">
							<span
								>{dayName(p.day)}: {p.quantity}
								{plural(p.quantity)}{p.cost !== null
									? `, ${euros(p.cost)}`
									: ', sin precio'}{p.fromExpense && !p.written ? ' (de Gastos)' : ''}</span
							>
							<button class={small} onclick={() => (editing = `p${p.id}`)}>Editar</button>
							<ConfirmForm
								action="?/removePurchase"
								fields={{ id: p.id, fuel: f.id }}
								label="Borrar"
								question="¿Borrar esta compra? Lo empezado de ella se queda{p.fromExpense
									? '; su gasto se vuelve a ofrecer'
									: ''}."
								class="text-xs text-zinc-500 hover:text-red-400"
							/>
						</div>
					{/if}
				</div>
			{:else}
				<p class="py-1 text-zinc-500">Ninguna aún.</p>
			{/each}
		</div>
	{/if}

	{#if settings}
		<div class="mt-4 border-t border-zinc-800 pt-3 text-sm">
			{#each f.spots as s (s.id)}
				<form
					method="post"
					action="?/saveSpot"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="mb-3 flex flex-wrap items-center gap-2"
				>
					<input type="hidden" name="fuel" value={f.id} />
					<input type="hidden" name="id" value={s.id} />
					<input
						name="name"
						defaultValue={s.name}
						maxlength="30"
						placeholder="Estufa, cocina…"
						aria-label="Dónde se pone"
						class="w-32 {input}"
					/>
					<label class="flex items-center gap-1"
						><input type="checkbox" name="heats" defaultChecked={s.heats} />Es para calentar</label
					>
					<label class="flex items-center gap-1"
						>{fem ? 'La' : 'El'}
						{meta.unit} dura unos
						<input
							type="number"
							name="guessDays"
							defaultValue={s.guessDays ?? ''}
							min="1"
							max="200"
							class="w-16 {input}"
						/>
						días{s.heats ? ' en invierno' : ''}</label
					>
					<button class={main}>Guardar</button>
				</form>
				{#if many}
					<div class="-mt-2 mb-3">
						<ConfirmForm
							action="?/archiveSpot"
							fields={{ id: s.id, fuel: f.id }}
							label="Quitar {s.name}"
							question="¿Quitar {s.name}? Lo aprendido se guarda por si vuelve.{s.unit
								? ` ${the} que tiene puest${fem ? 'a' : 'o'} se da por quitad${fem ? 'a' : 'o'} hoy, a medias.`
								: ''}"
							yes="Sí, quitar"
							class="text-xs text-zinc-500 hover:text-red-400"
						/>
					</div>
				{/if}
			{/each}
			<form
				method="post"
				action="?/addSpot"
				use:enhance={closing(nothing)}
				class="mb-4 flex flex-wrap items-center gap-2"
			>
				<input type="hidden" name="fuel" value={f.id} />
				<input type="hidden" name="id" value={f.id} />
				{#if only && !only.name}
					<span class="w-full text-xs text-zinc-500"
						>¿Tenéis más de {one} a la vez? Pon nombre al de arriba y añade el otro.</span
					>
				{/if}
				<input
					name="name"
					maxlength="30"
					required
					placeholder="Cocina, termo…"
					aria-label="Otro sitio donde se pone"
					class="w-32 {input}"
				/>
				<button class={button}>Añadir otro sitio</button>
			</form>
			<form
				method="post"
				action="?/saveFuel"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="flex flex-col gap-3 border-t border-zinc-800 pt-3"
			>
				<input type="hidden" name="fuel" value={f.id} />
				<input type="hidden" name="id" value={f.id} />
				{#if !many}
					<label class="flex items-center gap-2">
						<input type="checkbox" name="startsOnBuy" defaultChecked={f.startsOnBuy} />
						{fem ? 'La' : 'Lo'} pongo nada más comprarl{fem
							? 'a (cambio la vacía por una llena)'
							: 'o'}
					</label>
				{:else if f.startsOnBuy}
					<input type="hidden" name="startsOnBuy" value="on" />
				{/if}
				<label class="flex items-center gap-2">
					Llen{fem ? 'a' : 'o'}s en casa
					<input type="hidden" name="fullWas" value={f.full} />
					<input type="number" name="full" value={f.full} min="0" max="200" class="w-16 {input}" />
				</label>
				<label class="flex items-center gap-2">
					Avisar
					<input
						type="number"
						name="alertDays"
						value={f.alertDays}
						min="1"
						max="14"
						class="w-16 {input}"
					/>
					días antes de que se acabe
				</label>
				<div><button class={main}>Guardar</button></div>
			</form>
			<div class="mt-3">
				<ConfirmForm
					action="?/removeFuel"
					fields={{ id: f.id, fuel: f.id }}
					label="Quitar {meta.name.toLowerCase()}"
					question="¿Quitar {meta.name.toLowerCase()}? Se olvida lo apuntado y lo aprendido; los gastos de Dinero se quedan."
					class="text-xs text-zinc-500 hover:text-red-400"
				/>
			</div>
		</div>
	{/if}
</section>
