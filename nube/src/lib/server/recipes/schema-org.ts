/**
 * A cooking site's page, read: its schema.org Recipe (https://schema.org/Recipe), the JSON-LD most
 * of them publish for Google's rich results
 * (https://developers.google.com/search/docs/appearance/structured-data/recipe), and its name,
 * picture and text from the HTML, with Bun's own HTMLRewriter
 * (https://bun.sh/docs/api/html-rewriter).
 */

export interface PageRecipe {
	title: string;
	servings: number | null;
	ingredients: string[];
	/** As the site wrote them: whole paragraphs, sometimes. */
	instructions: string[];
	imageUrl: string | null;
}

export interface Page {
	/** Every JSON-LD block that parsed. */
	jsonLd: unknown[];
	/** og:site_name, else null. */
	siteName: string | null;
	/** og:title, else <title>. */
	title: string | null;
	imageUrl: string | null;
	/** Its visible text, for the AI when there is no Recipe: no scripts, styles nor menus. */
	text: string;
}

const MAX_TEXT = 30_000;

export async function readPage(html: string): Promise<Page> {
	const blocks: string[] = [];
	let block: string | null = null;
	const meta: Record<string, string> = {};
	let title = '';
	let inTitle = false;
	let skipping = 0;
	const text: string[] = [];
	let textLength = 0;

	// One handler per element: a second onEndTag on the same one replaces the first.
	const rewriter = new HTMLRewriter()
		// Not text to read: code, styles, and the site's own menus and footers. Among the scripts,
		// the JSON-LD.
		.on('script, style, noscript, svg, nav, header, footer, form, iframe', {
			element(el) {
				skipping++;
				const jsonLd = el.tagName === 'script' && el.getAttribute('type') === 'application/ld+json';
				if (jsonLd) block = '';
				el.onEndTag(() => {
					skipping--;
					if (jsonLd && block !== null) blocks.push(block);
					block = null;
				});
			},
			text(chunk) {
				if (block !== null) block += chunk.text;
			}
		})
		.on('meta[property], meta[name]', {
			element(el) {
				const key = el.getAttribute('property') ?? el.getAttribute('name');
				const content = el.getAttribute('content');
				if (key && content && !(key in meta)) meta[key] = content;
			}
		})
		.on('title', {
			element(el) {
				inTitle = true;
				el.onEndTag(() => {
					inTitle = false;
				});
			},
			text(chunk) {
				if (inTitle) title += chunk.text;
			}
		})
		.on('body *', {
			text(chunk) {
				if (skipping || textLength > MAX_TEXT) return;
				const t = chunk.text;
				if (t.trim()) {
					text.push(t);
					textLength += t.length;
				}
				if (chunk.lastInTextNode) text.push(' ');
			}
		});
	await rewriter.transform(new Response(html)).text();

	const jsonLd = blocks.flatMap((b) => {
		try {
			return [JSON.parse(b)];
		} catch {
			return [];
		}
	});
	return {
		jsonLd,
		siteName: clean(meta['og:site_name']) || null,
		title: clean(meta['og:title'] || title) || null,
		imageUrl: meta['og:image'] || null,
		text: decode(text.join('')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
	};
}

const isRecipe = (node: Record<string, unknown>) => {
	const type = node['@type'];
	return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
};

/** The first Recipe in the JSON-LD, wherever it is: alone, in a list or in an @graph. */
export function findRecipe(jsonLd: unknown[]): Record<string, unknown> | null {
	const queue = [...jsonLd];
	while (queue.length) {
		const node = queue.shift();
		if (Array.isArray(node)) queue.push(...node);
		else if (node && typeof node === 'object') {
			const obj = node as Record<string, unknown>;
			if (isRecipe(obj)) return obj;
			if (obj['@graph']) queue.push(obj['@graph']);
		}
	}
	return null;
}

/** The HTML entities sites leave in JSON-LD strings, and tags. */
function decode(value: string) {
	const named: Record<string, string> = {
		amp: '&',
		quot: '"',
		apos: "'",
		lt: '<',
		gt: '>',
		nbsp: ' ',
		ndash: '–',
		mdash: '—',
		hellip: '…',
		laquo: '«',
		raquo: '»',
		deg: '°',
		frac12: '½',
		frac14: '¼',
		frac34: '¾'
	};
	return value.replace(/&(#x[\da-f]+|#\d+|[a-z]\w*);/gi, (all, code: string) => {
		if (code[0] === '#')
			return String.fromCodePoint(
				code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
			);
		return named[code.toLowerCase()] ?? all;
	});
}

/**
 * A string from JSON-LD as text: entities decoded, tags out, spaces together. Some sites write
 * Markdown's bold in it (`**Derretir la mantequilla**`): out too, it is read aloud.
 */
function clean(value: unknown) {
	if (typeof value !== 'string') return '';
	return decode(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
		.replace(/\*\*|__/g, '')
		.replace(/[ \t]+/g, ' ')
		.trim();
}

/** recipeYield: `4`, `"4 personas"`, `["4", "4 raciones"]`. */
function servings(value: unknown): number | null {
	for (const v of Array.isArray(value) ? value : [value]) {
		const n = Number.parseInt(String(v ?? '').match(/\d+/)?.[0] ?? '', 10);
		if (n > 0 && n < 100) return n;
	}
	return null;
}

/** image: a URL, an ImageObject, or a list of either. */
function image(value: unknown): string | null {
	const first = Array.isArray(value) ? value[0] : value;
	if (typeof first === 'string') return first;
	if (first && typeof first === 'object') {
		const url = (first as Record<string, unknown>).url;
		if (typeof url === 'string') return url;
	}
	return null;
}

/**
 * recipeInstructions: one text (paragraphs, or an HTML list), a list of texts, of HowToStep, or of
 * HowToSection with their steps (https://schema.org/HowToSection).
 */
function instructions(value: unknown): string[] {
	if (typeof value === 'string') {
		const html = value.includes('<li') ? value.split(/<li[^>]*>/i).slice(1) : value.split(/\n+/);
		return html.map(clean).filter(Boolean);
	}
	if (!Array.isArray(value)) return value ? instructions([value]) : [];
	return value.flatMap((item): string[] => {
		if (typeof item === 'string') return instructions(item);
		if (!item || typeof item !== 'object') return [];
		const step = item as Record<string, unknown>;
		if (step.itemListElement) return instructions(step.itemListElement);
		return [clean(step.text) || clean(step.name)].filter(Boolean);
	});
}

export function normalizeRecipe(node: Record<string, unknown>): PageRecipe | null {
	const title = clean(node.name);
	const steps = instructions(node.recipeInstructions);
	if (!title || !steps.length) return null;
	return {
		title,
		servings: servings(node.recipeYield),
		ingredients: (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [])
			.map(clean)
			.filter(Boolean),
		instructions: steps,
		imageUrl: image(node.image)
	};
}
