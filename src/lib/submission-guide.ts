/**
 * «Как подать материалы» on /participants (Issue #99) — where the section
 * lives. The anchor is PERMANENT: the letter to already registered
 * participants (sent from the DS Platform) links to it, so it is not derived
 * from the heading and must not change with the copy.
 */
export const SUBMISSION_GUIDE_ANCHOR = 'podat-materialy';

export const SUBMISSION_GUIDE_HREF = `/participants#${SUBMISSION_GUIDE_ANCHOR}`;

/** Id of the n-th step (1-based), so a reply can point at one step. */
export const submissionStepId = (n: number): string => `${SUBMISSION_GUIDE_ANCHOR}-${n}`;
