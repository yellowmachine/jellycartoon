/** «340 MB», «1 GB», «1,5 GB»: a family's storage (#480), as it reads it. */
export function sizeText(bytes: number) {
	const mb = bytes / (1024 * 1024);
	if (mb < 1) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
	if (mb < 1024) return `${Math.round(mb)} MB`;
	return `${(mb / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} GB`;
}
