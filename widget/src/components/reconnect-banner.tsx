interface ReconnectBannerProps {
  /** Whether the socket is currently reconnecting. */
  active: boolean;
}

/**
 * Visible "reconnecting" indicator shown while the widget's socket is down
 * (issue #69). The spoken announcement is handled separately by the global
 * live region (`announceLiveMessage`), so this carries the visual cue only and
 * deliberately has NO live-region role of its own — a `role="status"` here
 * would make a screen reader announce the same text twice (once from this
 * element, once from the global region). Rendered as its own component so its
 * conditional stays out of the root component's complexity budget.
 * @param props - Whether reconnection is in progress.
 * @returns The banner when active, otherwise nothing.
 */
export function ReconnectBanner(props: ReconnectBannerProps): preact.JSX.Element | null {
  if (!props.active) return null;
  return <p class="reconnecting-banner">Connection lost. Reconnecting…</p>;
}
