interface ReconnectBannerProps {
  /** Whether the socket is currently reconnecting. */
  active: boolean;
}

/**
 * Visible "reconnecting" indicator shown while the widget's socket is down
 * (issue #69). The spoken announcement is handled separately by the global
 * live region (`announceLiveMessage`), so this carries the visual cue only.
 * Rendered as its own component so its conditional stays out of the root
 * component's complexity budget.
 * @param props - Whether reconnection is in progress.
 * @returns The banner when active, otherwise nothing.
 */
export function ReconnectBanner(props: ReconnectBannerProps): preact.JSX.Element | null {
  if (!props.active) return null;
  return (
    <p class="reconnecting-banner" role="status">
      Connection lost. Reconnecting…
    </p>
  );
}
