/** Named entities MediaWiki leaves in its HTML; the rest come as numbers. */
const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function decode(text: string) {
	return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
		if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
		const code =
			name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
		return String.fromCodePoint(code);
	});
}

/**
 * A Wikipedia article rendered by MediaWiki, as plain text for the AI: tables stay as rows with
 * their cells separated by `|`, and headings start with `##`. Footnotes and edit links are dropped.
 */
export function htmlToText(html: string) {
	const text = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '')
		.replace(/<sup\b[^>]*class="[^"]*reference[\s\S]*?<\/sup>/gi, '')
		.replace(/<span\b[^>]*class="[^"]*mw-editsection[\s\S]*?<\/span>\s*<\/span>/gi, '')
		.replace(/<h[1-6]\b[^>]*>/gi, '\n## ')
		.replace(/<\/t[dh]>/gi, ' | ')
		.replace(/<(br|hr)\b[^>]*>|<\/(tr|p|li|h[1-6]|caption|dd|dt|div)>/gi, '\n')
		.replace(/<[^>]+>/g, '');
	return decode(text)
		.split('\n')
		.map((line) =>
			line
				.replace(/\s+/g, ' ')
				.replace(/\s*\|\s*$/, '')
				.trim()
		)
		.filter(Boolean)
		.join('\n');
}
