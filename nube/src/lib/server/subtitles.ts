import { eq } from 'drizzle-orm';
import { familyMember } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { sanitizeSubtitleStyle, type SubtitleStyle } from 'comun/subtitle-style.ts';

/**
 * How each one's subtitles look (#253), as jellycartoon's: the channels', and later the series'.
 * Their own here, from the default: the house keeps its own.
 */

function who(k: Kitchen) {
	if (!k.userId) throw new Error('Los subtítulos son de cada persona');
	return k.userId;
}

export async function subtitleStyleOf(k: Kitchen): Promise<SubtitleStyle> {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ style: familyMember.subtitleStyle })
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
	);
	return sanitizeSubtitleStyle(row?.style);
}

export async function setSubtitleStyle(k: Kitchen, style: unknown) {
	const userId = who(k);
	await k.run((tx) =>
		tx
			.update(familyMember)
			.set({ subtitleStyle: sanitizeSubtitleStyle(style) })
			.where(eq(familyMember.userId, userId))
	);
}
