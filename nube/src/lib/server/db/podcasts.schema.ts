import {
	boolean,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's podcasts (#253; jellycartoon's #10): public feeds, followed by each of its people,
 * their episodes read now and then, and where each one is in each episode. The audio is played from
 * the podcast's own servers: nothing is downloaded.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

/** A public podcast, from its RSS feed; one row however many of the family follow it. */
export const podcast = pgTable(
	'podcast',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		feedUrl: text('feed_url').notNull(),
		title: text('title').notNull(),
		author: text('author'),
		description: text('description'),
		imageUrl: text('image_url'),
		/** The feed's own page, for the credits. */
		link: text('link'),
		/** When its feed was last read, and why it failed then, if it did. */
		checkedAt: timestamp('checked_at'),
		lastError: text('last_error'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('podcast_family_id').on(t.familyId, t.id),
		unique('podcast_feed_unique').on(t.familyId, t.feedUrl),
		familyRows('podcast_own', t.familyId)
	]
).enableRLS();

export const podcastEpisode = pgTable(
	'podcast_episode',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		podcastId: integer('podcast_id').notNull(),
		/** The feed's own id for it (its audio URL when it has none). */
		guid: text('guid').notNull(),
		title: text('title').notNull(),
		description: text('description'),
		audioUrl: text('audio_url').notNull(),
		durationSec: integer('duration_sec'),
		publishedAt: timestamp('published_at'),
		imageUrl: text('image_url')
	},
	(t) => [
		unique('podcast_episode_family_id').on(t.familyId, t.id),
		unique('podcast_episode_guid_unique').on(t.podcastId, t.guid),
		index('podcast_episode_published_idx').on(t.podcastId, t.publishedAt),
		foreignKey({
			name: 'podcast_episode_podcast_fk',
			columns: [t.familyId, t.podcastId],
			foreignColumns: [podcast.familyId, podcast.id]
		}).onDelete('cascade'),
		familyRows('podcast_episode_own', t.familyId)
	]
).enableRLS();

/** The podcasts each one follows. */
export const podcastSubscription = pgTable(
	'podcast_subscription',
	{
		familyId: familyId(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		podcastId: integer('podcast_id').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.podcastId] }),
		foreignKey({
			name: 'podcast_subscription_podcast_fk',
			columns: [t.familyId, t.podcastId],
			foreignColumns: [podcast.familyId, podcast.id]
		}).onDelete('cascade'),
		familyRows('podcast_subscription_own', t.familyId)
	]
).enableRLS();

/** Where each one is in each episode, to go on from there. */
export const podcastProgress = pgTable(
	'podcast_progress',
	{
		familyId: familyId(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		episodeId: integer('episode_id').notNull(),
		positionSec: real('position_sec').notNull(),
		completed: boolean('completed').notNull().default(false),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.episodeId] }),
		foreignKey({
			name: 'podcast_progress_episode_fk',
			columns: [t.familyId, t.episodeId],
			foreignColumns: [podcastEpisode.familyId, podcastEpisode.id]
		}).onDelete('cascade'),
		familyRows('podcast_progress_own', t.familyId)
	]
).enableRLS();
