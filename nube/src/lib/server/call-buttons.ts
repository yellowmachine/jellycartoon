import { callButtonStore } from './call-button.ts';
import { withFamily } from './family.ts';

/** The call button (#330), with the real database. */
export const callButtons = callButtonStore(withFamily);
