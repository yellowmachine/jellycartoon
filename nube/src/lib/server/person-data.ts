/**
 * What happens to each table when an adult leaves their family (#315), unlinked or on their own:
 * they become a family of one and take what is theirs. The one list of it, for the move and the
 * zip; a table not here fails person-data.test.ts, so a new one cannot be left behind unnoticed.
 *
 * - `moves`: their rows go with them, as they are.
 * - `onlyTheirsOrCopy`: what is only theirs goes with them; shared with others, they get a copy.
 * - `onlyTheirsOrStays`: what is only theirs goes with them; shared with others, it stays.
 * - `copies`: they get a copy; the original stays.
 * - `dropped`: their rows are deleted, as they mean nothing in the new family.
 * - `stays`: the family's; their rows stay, and they do not take them.
 * - `person`: who they are: a new row in the new family; the old family keeps them as a person
 *   without an account, or forgets the membership.
 * - `account`: of the account, of no family: nothing to move.
 */
export type Leaving =
	| 'moves'
	| 'onlyTheirsOrCopy'
	| 'onlyTheirsOrStays'
	| 'copies'
	| 'dropped'
	| 'stays'
	| 'person'
	| 'account';

export interface PersonData {
	leaving: Leaving;
	/** What the rule alone does not say. */
	note?: string;
}

export const PERSON_DATA: Record<string, PersonData> = {
	// Who they are.
	family_member: { leaving: 'person', note: 'Their own settings go to the new row' },
	family_person: { leaving: 'person', note: 'The old row stays, with user_id null' },

	// Agenda.
	calendar_event: { leaving: 'onlyTheirsOrCopy', note: 'By calendar_event_person' },
	calendar_event_person: { leaving: 'onlyTheirsOrCopy', note: 'Follows its event' },
	alarm: { leaving: 'onlyTheirsOrCopy', note: 'By alarm_person' },
	alarm_person: { leaving: 'onlyTheirsOrCopy', note: 'Follows its alarm' },
	agenda_link: { leaving: 'stays', note: 'The family calendar link' },
	push_subscription: { leaving: 'moves', note: 'Their phones keep getting notices' },

	// Medication: by whom it is for (person_id), not by who wrote it down.
	medication: { leaving: 'moves', note: 'By person_id' },
	medication_dose: { leaving: 'moves', note: 'Follows its medication' },

	// Papeles: sealed with the family key, so what leaves is sealed again with the new one.
	paper: { leaving: 'onlyTheirsOrCopy', note: 'By paper_person. Sealed again, its file too' },
	paper_person: { leaving: 'onlyTheirsOrCopy', note: 'Follows its paper' },
	paper_event: { leaving: 'onlyTheirsOrCopy', note: 'Only if its event goes too' },
	family_data_key: { leaving: 'stays', note: 'The new family gets its own' },

	// Trips and the road.
	trip: { leaving: 'moves', note: 'car_id empty unless the car goes too' },
	trip_photo: { leaving: 'moves', note: 'Its file too' },
	saved_place: { leaving: 'moves' },
	saved_route: { leaving: 'moves' },
	route_map: { leaving: 'dropped', note: 'Its route leaves and its device stays' },
	map_device: { leaving: 'stays', note: 'The car tablet; a phone registers again' },
	offline_list: { leaving: 'stays', note: 'A playlist of the house on a device' },
	car: { leaving: 'onlyTheirsOrStays', note: 'Goes if they are its only driver' },
	car_driver: { leaving: 'onlyTheirsOrStays', note: 'Follows its car; deleted if it stays' },
	planned_trip: { leaving: 'onlyTheirsOrCopy', note: 'By planned_trip_person' },
	planned_trip_person: { leaving: 'onlyTheirsOrCopy', note: 'Follows its trip' },
	planned_leg: { leaving: 'onlyTheirsOrCopy', note: 'Follows its trip' },

	// Walks and notes.
	walk: { leaving: 'moves' },
	walk_photo: { leaving: 'moves', note: 'Its file too' },
	note: { leaving: 'moves', note: 'Its audio too' },

	// The voice: only rows with their user_id; null is the whole house's.
	memory: { leaving: 'moves', note: 'Only with their user_id' },
	rule: { leaving: 'moves', note: 'Only with their user_id' },
	heard: { leaving: 'moves', note: 'Only with their user_id' },
	inbox: { leaving: 'moves', note: 'from_user_id empty: the sender stays behind' },
	voice_learned: { leaving: 'stays' },
	voice_satellite: { leaving: 'stays' },

	// Podcasts: followed person by person from the family's catalogue.
	podcast: { leaving: 'copies', note: 'Those they follow' },
	podcast_episode: { leaving: 'copies', note: 'Of those they follow' },
	podcast_subscription: { leaving: 'moves', note: 'Pointing at the copied podcast' },
	podcast_progress: { leaving: 'moves', note: 'Pointing at the copied episode' },

	// Money.
	expense: { leaving: 'stays' },
	expense_line: { leaving: 'stays' },
	expense_favorite: { leaving: 'stays' },
	recurring_expense: { leaving: 'stays' },
	income: { leaving: 'stays' },
	recurring_income: { leaving: 'stays' },
	bill: { leaving: 'stays' },
	ai_cost: { leaving: 'stays' },

	// Kitchen.
	fridge_note: { leaving: 'stays' },
	fridge_item: { leaving: 'stays' },
	recipe: { leaving: 'stays' },
	recipe_site: { leaving: 'stays' },
	recipe_site_page: { leaving: 'stays' },
	recipe_site_sitemap: { leaving: 'stays' },

	// Prayer.
	prayer: { leaving: 'stays' },
	prayer_voice: { leaving: 'stays' },
	prayer_list: { leaving: 'stays' },
	prayer_list_item: { leaving: 'stays' },

	// Children: theirs stay in the family.
	homework: { leaving: 'stays' },
	kid_account: { leaving: 'stays' },
	kid_guardian: { leaving: 'dropped', note: 'Where they are the guardian' },
	kid_permit: { leaving: 'stays' },
	kid_login_request: { leaving: 'stays' },
	trusted_device: { leaving: 'stays' },

	// The family's own things.
	family_settings: { leaving: 'stays', note: 'The new family starts with the defaults' },
	house: { leaving: 'stays' },
	house_key: { leaving: 'stays' },
	telegram_bot: { leaving: 'stays' },
	invitation: { leaving: 'stays' },

	// The account: it is the same one.
	session: { leaving: 'account' },
	account: { leaving: 'account' },
	two_factor: { leaving: 'account' },
	oauth_client: { leaving: 'account', note: "A house's client: its family's" },
	oauth_consent: { leaving: 'account', note: "Revoked: the house is the old family's" },
	oauth_access_token: { leaving: 'account', note: "Revoked: the house is the old family's" },
	oauth_refresh_token: { leaving: 'account', note: "Revoked: the house is the old family's" }
};
