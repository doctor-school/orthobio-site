/**
 * «Как подать материалы» on /participants (Issue #99) — where the section
 * lives. The anchor is PERMANENT: the letter to already registered
 * participants (sent from the DS Platform) links to it, so it is not derived
 * from the heading and must not change with the copy.
 */
export const SUBMISSION_GUIDE_ANCHOR = 'podat-materialy';

export const SUBMISSION_GUIDE_HREF = `/participants#${SUBMISSION_GUIDE_ANCHOR}`;

/**
 * «Как заполнить заявку» (owner, 2026-10-07): the cabinet steps, split off the
 * sign-in so a reader who signed in by one route — the success card's personal
 * button or the guide above — is never walked through sign-in again. Both
 * routes end with a link here, so this anchor is permanent too.
 */
export const FILL_GUIDE_ANCHOR = 'zapolnit-zayavku';

/** The two guide blocks of /participants, each at its own fixed anchor. */
export const GUIDE_ANCHORS = [SUBMISSION_GUIDE_ANCHOR, FILL_GUIDE_ANCHOR] as const;

export type GuideAnchor = (typeof GUIDE_ANCHORS)[number];

/** Id of the n-th step (1-based) of a guide, so a reply can point at one step. */
export const guideStepId = (anchor: GuideAnchor, n: number): string => `${anchor}-${n}`;

export const submissionStepId = (n: number): string => guideStepId(SUBMISSION_GUIDE_ANCHOR, n);
