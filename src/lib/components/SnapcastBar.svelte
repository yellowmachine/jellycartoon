<script lang="ts">
	import { formatDuration } from '#lib/format.ts';
	import { coverUrl } from '#lib/music.ts';
	import { musicTarget, watchSnapcast } from '#lib/music-target.svelte.ts';

	const snapcast = watchSnapcast();
	const snap = $derived(snapcast.state);
	const track = $derived(snap?.track);

	const control =
		'flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-zinc-800';

	let showSpeakers = $state(false);
	/** The speaker whose name is being edited. */
	let renaming = $state<string | null>(null);
	/** While a volume is being dragged it shows the finger, not snapserver. */
	let dragging = $state<{ id: string; value: number } | null>(null);
</script>

<!-- Only while something plays on Snapcast, whoever sent it. -->
{#if snap?.active}
	<div class="rounded-md border border-zinc-700 bg-zinc-900/80 p-2 backdrop-blur">
		{#if showSpeakers}
			<div class="mb-2 border-b border-zinc-800 pb-2">
				{#if !snap.speakers}
					<p class="text-sm text-zinc-400">
						No se puede conectar con el control de snapserver (SNAPSERVER_CONTROL).
					</p>
				{:else if !snap.speakers.length}
					<p class="text-sm text-zinc-400">
						No hay altavoces. Arranca snapclient en alguno, apuntando a este equipo.
					</p>
				{:else}
					<ul class="space-y-1">
						{#each snap.speakers as speaker (speaker.id)}
							<li class={['flex items-center gap-3', !speaker.connected && 'opacity-50']}>
								<span
									class={[
										'h-2 w-2 shrink-0 rounded-full',
										speaker.connected ? 'bg-green-500' : 'bg-zinc-600'
									]}
									title={speaker.connected ? 'Conectado' : 'Desconectado'}
								></span>
								{#if renaming === speaker.id}
									<form
										class="min-w-0 flex-1"
										onsubmit={(e) => {
											e.preventDefault();
											const name = new FormData(e.currentTarget).get('name');
											void musicTarget.send({
												action: 'rename',
												speakerId: speaker.id,
												name: String(name ?? '')
											});
											renaming = null;
										}}
									>
										<!-- svelte-ignore a11y_autofocus -->
										<input
											name="name"
											value={speaker.name === speaker.hostName ? '' : speaker.name}
											placeholder={speaker.hostName}
											aria-label="Nombre del altavoz"
											autofocus
											onkeydown={(e) => e.key === 'Escape' && (renaming = null)}
											onblur={(e) => e.currentTarget.form?.requestSubmit()}
											class="w-full rounded border-zinc-700 bg-zinc-900 py-0.5 text-sm"
										/>
									</form>
								{:else}
									<button
										class="min-w-0 flex-1 truncate text-left text-sm hover:text-amber-400"
										title="Cambiar nombre ({speaker.hostName})"
										onclick={() => (renaming = speaker.id)}
										>{speaker.name}{#if !speaker.connected}
											<span class="text-xs text-zinc-500"> · desconectado</span>{/if}</button
									>
								{/if}
								<button
									class="w-6 shrink-0 text-sm"
									aria-label={speaker.muted ? 'Quitar silencio' : 'Silenciar'}
									title={speaker.muted ? 'Quitar silencio' : 'Silenciar'}
									onclick={() =>
										musicTarget.send({
											action: 'mute',
											speakerId: speaker.id,
											value: !speaker.muted
										})}>{speaker.muted ? '🔇' : '🔊'}</button
								>
								<input
									type="range"
									min="0"
									max="100"
									step="1"
									value={dragging?.id === speaker.id ? dragging.value : speaker.volume}
									aria-label="Volumen de {speaker.name}"
									class="w-28 shrink-0 accent-amber-500 sm:w-40"
									oninput={(e) =>
										(dragging = { id: speaker.id, value: Number(e.currentTarget.value) })}
									onchange={(e) => {
										void musicTarget.send({
											action: 'volume',
											speakerId: speaker.id,
											value: Number(e.currentTarget.value)
										});
										dragging = null;
									}}
								/>
								<span class="w-8 shrink-0 text-right font-mono text-xs text-zinc-400 tabular-nums"
									>{dragging?.id === speaker.id ? dragging.value : speaker.volume}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
				{#if musicTarget.error}
					<p class="mt-2 text-sm text-red-400">{musicTarget.error}</p>
				{/if}
			</div>
		{/if}
		<input
			type="range"
			min="0"
			max={snap.durationSec ?? track?.durationSec ?? 0}
			step="1"
			value={snap.positionSec ?? 0}
			aria-label="Posición"
			class="mb-1 block h-1 w-full accent-amber-500"
			onchange={(e) => musicTarget.send({ action: 'seekTo', value: Number(e.currentTarget.value) })}
		/>
		<div class="flex items-center gap-3">
			<a
				href={track ? `/musica/${track.albumId}` : '/musica'}
				class="flex min-w-0 flex-1 items-center gap-3"
			>
				{#if track?.hasCover}
					<img
						src={coverUrl(track.albumId)}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>♪</span
					>
				{/if}
				<span class="min-w-0">
					<span class="block truncate text-sm">
						<span class="text-amber-400">Snapcast:</span>
						{track?.title ?? '…'}
					</span>
					{#if track}
						<span class="block truncate text-xs text-zinc-400">{track.artist} · {track.album}</span>
					{/if}
				</span>
			</a>
			<span class="hidden font-mono text-xs text-zinc-400 tabular-nums sm:inline">
				{formatDuration(snap.positionSec) || '0:00'} / {formatDuration(
					snap.durationSec ?? track?.durationSec
				)}
			</span>
			<button
				class={control}
				aria-label="Anterior"
				onclick={() => musicTarget.send({ action: 'previous' })}>{'⏮︎'}</button
			>
			<button
				class="{control} bg-amber-500 text-zinc-950 hover:bg-amber-400"
				aria-label={snap.paused ? 'Seguir' : 'Pausa'}
				onclick={() => musicTarget.send({ action: 'pause', value: !snap.paused })}
				>{snap.paused ? '▶︎' : '❚❚'}</button
			>
			<button
				class={control}
				aria-label="Siguiente"
				disabled={snap.playlistPos !== null && snap.playlistPos >= (snap.playlistCount ?? 0)}
				onclick={() => musicTarget.send({ action: 'next' })}>{'⏭︎'}</button
			>
			<button
				class={[control, showSpeakers ? 'text-amber-400' : 'text-zinc-400 hover:text-white']}
				aria-label="Altavoces"
				aria-expanded={showSpeakers}
				title="Altavoces"
				onclick={() => (showSpeakers = !showSpeakers)}>🔈</button
			>
			<button
				class="{control} text-zinc-400 hover:text-white"
				aria-label="Parar"
				title="Parar Snapcast"
				onclick={() => musicTarget.send({ action: 'stop' })}>■</button
			>
		</div>
	</div>
{/if}
