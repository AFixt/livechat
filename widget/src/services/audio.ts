const COOKIE_NAME = 'afixt_livechat_muted';

/**
 * Return the value of a cookie by name, or undefined if not set.
 * @param name - Cookie name.
 * @returns Cookie value or undefined.
 */
function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return undefined;
}

/**
 * True if the visitor has muted the alert sound (persisted in a cookie so
 * the mute preference survives page navigation within the session).
 * @returns Whether the sound is muted.
 */
export function isMuted(): boolean {
  return readCookie(COOKIE_NAME) === '1';
}

/**
 * Persist the mute preference in a 30-day cookie.
 * @param muted - New mute state.
 */
export function setMuted(muted: boolean): void {
  document.cookie = `${COOKIE_NAME}=${muted ? '1' : '0'}; Max-Age=${(30 * 24 * 60 * 60).toString()}; Path=/; SameSite=Lax`;
}

let audio: HTMLAudioElement | null = null;

/**
 * Lazily construct the shared `<audio>` element. Inlined data-URI WAV is a
 * placeholder chime; replace with a real asset before production.
 * @returns The shared audio element.
 */
function getAudio(): HTMLAudioElement {
  audio ??= new Audio(
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
  );
  return audio;
}

/**
 * Play the alert sound unless the visitor has muted it.
 */
export function playAlert(): void {
  if (isMuted()) return;
  try {
    const a = getAudio();
    a.currentTime = 0;
    void a.play();
  } catch {
    // autoplay policy may block until user interaction — silently noop
  }
}
