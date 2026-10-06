export function formatDuration(seconds: number | null | undefined) {
	if (!seconds) return '';
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = String(m).padStart(h ? 2 : 1, '0');
	return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined) {
	if (!bytes) return '—';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
	return `${(bytes / 1000 ** i).toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}
