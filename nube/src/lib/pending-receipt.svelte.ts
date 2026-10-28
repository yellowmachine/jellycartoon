/**
 * A receipt's photo taken from the header's shortcut (#194), on its way to Gastos: the camera
 * opens only on a tap, so the header takes it and Gastos reads it once there.
 */
class PendingReceipt {
	photo = $state<File | null>(null);

	/** The one waiting, once: taken by whoever reads it. */
	take() {
		const photo = this.photo;
		this.photo = null;
		return photo;
	}
}

export const pendingReceipt = new PendingReceipt();
