import { asUser } from './family.ts';
import { kmsOn, scaleway } from './family-secret.ts';
import { decrypt, encrypt } from './secret-box.ts';
import { userSecrets } from './user-secret-scope.ts';

/** A person's secrets (user-secret-scope.ts), with Key Manager if the KMS is on. */
export const secretsOfUser = userSecrets({
	asUser,
	kms: kmsOn ? scaleway : null,
	plain: { encrypt, decrypt }
});
