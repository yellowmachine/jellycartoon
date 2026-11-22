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

/** Query parameters that only follow who came from where: out of the address kept. */
const TRACKING =
	/^(utm_.*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|srsltid|ref|ref_|tag|linkcode|linkid|camp|creative|creativeasin|ascsubtag|spm|scm|pvid|algo_.*|aff_.*|sk|gatewayadapt|_randl_.*|share_.*|social_share)$/i;

/**
 * A product's address as it is kept (#586): Amazon's as `/dp/<ASIN>`, an AliExpress item's without
 * its query, any other without what only tracks. `key`, the same for one product however it was
 * shared (a short link, a long one, another tracking), to tell it is already in a list.
 */
export function cleanLink(address: string): { url: string; key: string } {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return { url: address, key: `url:${address}` };
	}
	url.hash = '';
	const host = url.hostname.toLowerCase();
	if (knownShop(address) === 'Amazon') {
		const asin = url.pathname.match(
			/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i
		)?.[1];
		if (asin) {
			const id = asin.toUpperCase();
			return { url: `https://${host}/dp/${id}`, key: `amazon:${id}` };
		}
	}
	if (knownShop(address) === 'AliExpress') {
		const item = url.pathname.match(/\/item\/(\d+)\.html/)?.[1];
		if (item) return { url: `https://${host}/item/${item}.html`, key: `aliexpress:${item}` };
	}
	for (const name of [...url.searchParams.keys()])
		if (TRACKING.test(name)) url.searchParams.delete(name);
	const clean = url.href.replace(/\?$/, '');
	return { url: clean, key: `url:${clean.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase()}` };
}

/** «el 22 nov», the day a price was seen: prices change and are not watched. */
export function seenOn(at: Date | string | null) {
	if (!at) return null;
	const day = new Date(at);
	return Number.isNaN(day.getTime())
		? null
		: `el ${day.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')}`;
}

/**
 * A wish proposed in Preguntar (#586): a link pasted in the chat, read, for whose list. Added with a
 * touch: `added`, its number in the list; `already`, the one that was there.
 */
export interface WishCard {
	kind: 'deseo';
	url: string;
	productKey: string;
	shop: string;
	title: string;
	imageUrl: string | null;
	priceCents: number | null;
	currency: string | null;
	personId: string;
	personName: string;
	added: number | null;
	already: number | null;
}

/**
 * A price as a page shows it to people («29,99 €», «€1.299,00», «$29.99»): in cents and its
 * currency; null if there is no price in it. The last «,» or «.» with one or two digits after it is
 * the decimal one.
 */
export function priceFromText(text: string | null | undefined) {
	const said = (text ?? '')
		.replace(/\u00a0/g, ' ')
		.trim()
		.slice(0, 40);
	const number = said.match(/\d[\d.,\s]*/)?.[0]?.trim();
	if (!number) return null;
	const decimal = number.match(/[.,](\d{1,2})$/);
	const whole = (decimal ? number.slice(0, -decimal[0].length) : number).replace(/[.,\s]/g, '');
	const cents = Number(whole) * 100 + (decimal ? Number(decimal[1]!.padEnd(2, '0')) : 0);
	if (!Number.isFinite(cents) || cents <= 0 || cents >= 100_000_000) return null;
	const currency = /\$/.test(said) ? 'USD' : /£/.test(said) ? 'GBP' : 'EUR';
	return { cents, currency };
}

/**
 * The bookmark for a computer's browser (#586): run on a shop's page, it reads what the browser
 * already shows (the page's schema.org Product and og:… tags; Amazon's own title, price and
 * picture) and opens Seilide's question of a shared link with it. Nothing is read by the server: a
 * shop that blocks servers (Amazon) is read by the person's own browser.
 */
export function bookmarklet(origin: string) {
	const code = `(()=>{const q=s=>document.querySelector(s),m=n=>q('meta[property="'+n+'"],meta[name="'+n+'"]')?.content,t=e=>e?.textContent?.trim();let p=null;for(const s of document.querySelectorAll('script[type="application/ld+json"]')){try{const w=[JSON.parse(s.textContent)];while(w.length&&!p){const n=w.shift();if(Array.isArray(n))w.push(...n);else if(n&&typeof n==='object'){const y=[].concat(n['@type']);if(y.includes('Product'))p=n;else if(n['@graph'])w.push(n['@graph'])}}}catch(e){}if(p)break}const o=p&&[].concat(p.offers||[])[0],i=p&&[].concat(p.image||[])[0],g=q('#landingImage'),d={url:location.href,titulo:t(q('#productTitle'))||p?.name||m('og:title')||document.title,precio:t(q('.a-price .a-offscreen'))||(o&&(o.price||o.lowPrice)?(o.price||o.lowPrice)+' '+(o.priceCurrency==='USD'?'$':o.priceCurrency==='GBP'?'£':'€'):m('product:price:amount')||''),foto:g?.dataset?.oldHires||(g?.dataset?.aDynamicImage&&Object.keys(JSON.parse(g.dataset.aDynamicImage))[0])||(typeof i==='string'?i:i?.url)||m('og:image')||''};for(const k in d)d[k]=String(d[k]||'').slice(0,2000);window.open(${JSON.stringify(origin)}+'/compartido/enlace?'+new URLSearchParams(d))})()`;
	return `javascript:${encodeURIComponent(code)}`;
}
