interface InvitationProps {
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * State 2 (§5.1.2) — "support is available" flourish. Rendered on top of
 * the trigger when staff is online.
 * @param props - Open and dismiss callbacks.
 * @returns The invitation element.
 */
export function InvitationState(props: InvitationProps): preact.JSX.Element {
  return (
    <section aria-label="Chat invitation">
      <p>Our support team is online right now.</p>
      <button type="button" class="primary" onClick={props.onOpen}>
        Start a chat
      </button>
      <button type="button" onClick={props.onDismiss} aria-label="Dismiss chat invitation">
        Not now
      </button>
    </section>
  );
}
