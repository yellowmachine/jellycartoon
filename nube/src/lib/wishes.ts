/**
 * Lista de deseos (#586), what the page and the server both need: a product's shop by its address,
 * and its price as written.
 */

export const MAX_WISH_TITLE = 300;
export const MAX_WISH_NOTE = 500;
export const MAX_WISH_URL = 2000;

/** Shops known by a word of their address, and how they are called. */
const SHOPS: [RegExp, string][] = [
	// Its short links (shared from its app) too, before they are followed.
	[/(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co)$/, 'Amazon'],
	[/(^|\.)aliexpress\.[a-z.]+$/, 'AliExpress'],
	[/(^|\.)elcorteingles\.[a-z.]+$/, 'El Corte Inglés'],
	[/(^|\.)ikea\.[a-z.]+$/, 'IKEA'],
	[/(^|\.)pccomponentes\.[a-z.]+$/, 'PcComponentes'],
	[/(^|\.)mediamarkt\.[a-z.]+$/, 'MediaMarkt'],
	[/(^|\.)decathlon\.[a-z.]+$/, 'Decathlon'],
	[/(^|\.)zara\.[a-z.]+$/, 'Zara'],
	[/(^|\.)mango\.[a-z.]+$/, 'Mango'],
	[/(^|\.)hm\.com$/, 'H&M'],
	[/(^|\.)primark\.[a-z.]+$/, 'Primark'],
	[/(^|\.)leroymerlin\.[a-z.]+$/, 'Leroy Merlin'],
	[/(^|\.)fnac\.[a-z.]+$/, 'Fnac'],
	[/(^|\.)carrefour\.[a-z.]+$/, 'Carrefour'],
	[/(^|\.)lidl\.[a-z.]+$/, 'Lidl'],
	[/(^|\.)worten\.[a-z.]+$/, 'Worten'],
	[/(^|\.)casadellibro\.[a-z.]+$/, 'Casa del Libro'],
	[/(^|\.)ebay\.[a-z.]+$/, 'eBay'],
	[/(^|\.)(temu\.com|temu\.to)$/, 'Temu'],
	[/(^|\.)shein\.[a-z.]+$/, 'Shein'],
	[/(^|\.)etsy\.[a-z.]+$/, 'Etsy'],
	[/(^|\.)miravia\.[a-z.]+$/, 'Miravia'],
	[/(^|\.)wallapop\.[a-z.]+$/, 'Wallapop'],
	[/(^|\.)toysrus\.[a-z.]+$/, 'Toys "R" Us'],
	[/(^|\.)apple\.com$/, 'Apple']
];

const hostOf = (address: string) => {
	try {
		const url = new URL(address);
		return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase() : null;
	} catch {
		return null;
	}
};

/** One of the shops known: «Amazon» for amazon.es and amzn.eu alike. */
export function knownShop(address: string) {
	const host = hostOf(address);
	return host ? (SHOPS.find(([re]) => re.test(host))?.[1] ?? null) : null;
}

/** Its shop: a known one by its name, any other by its address without `www.`. */
export function shopOf(address: string) {
	return knownShop(address) ?? hostOf(address)?.replace(/^www\./, '') ?? 'Tienda';
}

/** «29,99 €», as Spain writes it; null without a price. */
export function priceText(cents: number | null, currency: string | null) {
	if (cents === null) return null;
	try {
		return new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: currency || 'EUR'
		}).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2).replace('.', ',')} ${currency ?? ''}`.trim();
	}
}
