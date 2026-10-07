/**
 * «Как подать материалы» on /participants (Issue #99) — where the section
 * lives. The anchor is PERMANENT: the letter to already registered
 * participants (sent from the DS Platform) links to it, so it is not derived
 * from the heading and must not change with the copy.
 */
export const SUBMISSION_GUIDE_ANCHOR = 'podat-materialy';

export const SUBMISSION_GUIDE_HREF = `/participants#${SUBMISSION_GUIDE_ANCHOR}`;

/**
 * «Как заполнить заявку» (owner, 2026-10-07): the cabinet steps on a page of
 * their own, apart from the sign-in, so a reader who signed in by one route —
 * the success card's personal button or the guide on /participants — never
 * scrolls past the sign-in again. Both routes end with a link to this page.
 * Its block keeps the anchor, so the step ids stay `zapolnit-zayavku-<n>`.
 */
export const FILL_GUIDE_ANCHOR = 'zapolnit-zayavku';

export const FILL_GUIDE_PATH = `/participants/${FILL_GUIDE_ANCHOR}`;

/**
 * The guide used to sit at /participants#zapolnit-zayavku. The fragment never
 * reaches the server, so only the page itself can send such a link on — this
 * script, inlined on /participants, does, step anchors included.
 */
export const FILL_GUIDE_REDIRECT_SCRIPT = `var m = /^#${FILL_GUIDE_ANCHOR}(-\\d+)?$/.exec(location.hash);
if (m) location.replace(${JSON.stringify(FILL_GUIDE_PATH)} + (m[1] ? ${JSON.stringify(`#${FILL_GUIDE_ANCHOR}`)} + m[1] : ''));`;

/** The two guide blocks, each at its own fixed anchor. */
export const GUIDE_ANCHORS = [SUBMISSION_GUIDE_ANCHOR, FILL_GUIDE_ANCHOR] as const;

export type GuideAnchor = (typeof GUIDE_ANCHORS)[number];

/** Id of the n-th step (1-based) of a guide, so a reply can point at one step. */
export const guideStepId = (anchor: GuideAnchor, n: number): string => `${anchor}-${n}`;
