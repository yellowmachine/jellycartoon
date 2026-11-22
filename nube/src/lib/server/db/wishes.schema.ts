import {
	foreignKey,
	index,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { familyPerson } from './agenda.schema.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Lista de deseos (#586): what each person of the family would like, from any shop, shared from
 * the phone or pasted. Seen by the whole family; who will give it (`giftBy`), by everyone but the
 * person it is for.
 */
export const wish = pgTable(
	'wish',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Whose wish: a person of the family, with an account or not (a child). */
		personId: integer('person_id').notNull(),
		/** The product's page, as it ended after its redirects (a short link, followed). */
		url: text('url').notNull(),
		/** Its shop, by the address: «Amazon», «IKEA», «tienda.com». */
		shop: text('shop').notNull(),
		title: text('title').notNull(),
		/** The shop's own picture, shown from there. */
		imageUrl: text('image_url'),
		/**
		 * The same for one product however it was shared (lib/wishes.ts cleanLink): `amazon:<ASIN>`,
		 * or its address without tracking. Null, kept before it.
		 */
		productKey: text('product_key'),
		/** As the page said it, in cents of `currency`; null, not said. */
		priceCents: integer('price_cents'),
		currency: text('currency'),
		/** When that price was seen: it changes, and is not watched. */
		priceAt: timestamp('price_at'),
		/** A size, a colour: what the shop's page does not say. */
		note: text('note'),
		/** Who added it; gone, the wish stays. */
		addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
		/** «Lo regalo yo»: who will give it, hidden from the person it is for. */
		giftBy: text('gift_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('wish_person_idx').on(t.familyId, t.personId, t.productKey),
		unique('wish_family_id').on(t.familyId, t.id),
		foreignKey({
			name: 'wish_person_fk',
			columns: [t.familyId, t.personId],
			foreignColumns: [familyPerson.familyId, familyPerson.id]
		}).onDelete('cascade'),
		familyRows('wish_own', t.familyId)
	]
).enableRLS();
