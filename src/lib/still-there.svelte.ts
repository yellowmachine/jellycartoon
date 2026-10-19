/**
 * «¿Sigues ahí?» (#77) in this browser: episodes «siguiente automático» started by itself since
 * anyone last touched anything here. A module, so it goes on from one episode's page to the next.
 */
class StillThere {
	unattended = 0;

	/** The countdown ended and played the next one. */
	startedByItself() {
		this.unattended++;
	}

	/** A touch, a click or a key: someone is there. */
	someoneThere() {
		this.unattended = 0;
	}
}

export const stillThere = new StillThere();
