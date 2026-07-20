interface SupportInitiatedProps {
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * State 5 (§5.1.5) — support staff initiated a chat. Rendered as a modal-
 * style dialog so the accept/dismiss decision is unmissable.
 * @param props - Accept and dismiss callbacks.
 * @returns The invite dialog.
 */
export function SupportInitiatedState(props: SupportInitiatedProps): preact.JSX.Element {
  return (
    <section aria-labelledby="afixt-support-heading">
      <h2 id="afixt-support-heading">A support agent wants to chat</h2>
      <p>Would you like to start a conversation right now?</p>
      <button type="button" class="primary" onClick={props.onAccept}>
        Accept
      </button>
      <button type="button" onClick={props.onDismiss}>
        Not now
      </button>
    </section>
  );
}
