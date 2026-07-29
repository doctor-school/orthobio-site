/**
 * Embed-URL derivation for the click-to-load video facade (design brief §3.5).
 *
 * Only Rutube gets an in-page player. YouTube — 20 of the 23 archive videos —
 * is a lottery for a physician in the RF since 2024, and RF accessibility is a
 * hard constraint, so a YouTube card stays an outbound link that says so out
 * loud instead of embedding a frame that may never paint.
 */

/** Rutube video ids are 32 hex chars; anything else is a channel/search path. */
const RUTUBE_ID = /^[0-9a-f]{32}$/i;

/**
 * Player URL for a video the site can embed, or `null` when the card must fall
 * back to an outbound link.
 *
 * `autoplay=true` is honest here and only here: the URL is built after the
 * visitor has clicked the facade, so the frame that loads is the frame they
 * asked to watch — no second click inside the player.
 */
export const videoEmbedSrc = (url: string): string | null => {
  const u = URL.parse(url);
  if (u?.protocol !== 'https:' || u.hostname !== 'rutube.ru') return null;

  const segments = u.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (segments[0] === 'video') {
    // `/video/private/<id>` — a link-only upload; the id sits one slot further.
    id = segments[1] === 'private' ? segments[2] : segments[1];
  } else if (segments[0] === 'play' && segments[1] === 'embed') {
    id = segments[2];
  }
  if (!id || !RUTUBE_ID.test(id)) return null;

  const embed = new URL(`https://rutube.ru/play/embed/${id}/`);
  // Access token of a link-only video: dropping it turns the player into «видео
  // не найдено». Every other query param on the watch URL is tracking noise.
  const token = u.searchParams.get('p');
  if (token) embed.searchParams.set('p', token);
  embed.searchParams.set('autoplay', 'true');
  return embed.href;
};
