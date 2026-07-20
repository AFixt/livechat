const MUTE_KEY = 'livechat.alertSoundMuted';

let audio: HTMLAudioElement | null = null;

/**
 * Lazily construct the shared `<audio>` element. Inlined data-URI WAV is a
 * placeholder; replace with a proper chime asset before production.
 * @returns The shared audio element.
 */
function getAudio(): HTMLAudioElement {
  audio ??= new Audio(
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=',
  );
  return audio;
}

/**
 * Is the alert sound currently muted? Persisted to localStorage.
 * @returns True if muted.
 */
export function isAlertMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1';
}

/**
 * Toggle the mute state.
 * @returns The new muted state.
 */
export function toggleAlertMute(): boolean {
  const now = !isAlertMuted();
  localStorage.setItem(MUTE_KEY, now ? '1' : '0');
  return now;
}

/**
 * Play the alert sound unless muted.
 */
export function playAlertSound(): void {
  if (isAlertMuted()) return;
  try {
    const a = getAudio();
    a.currentTime = 0;
    void a.play();
  } catch {
    // autoplay policy may block until user interaction — silently noop
  }
}
