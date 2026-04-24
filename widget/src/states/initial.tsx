interface InitialProps {
  onOpen: () => void;
}

/**
 * State 1 (§5.1.1) — the closed-widget trigger button. Always rendered at
 * the bottom of the widget tree when the panel is closed.
 * @param props - `onOpen` is invoked when the visitor activates the CTA.
 * @returns The trigger element.
 */
export function InitialState(props: InitialProps): preact.JSX.Element {
  return (
    <button type="button" class="trigger" onClick={props.onOpen}>
      <span aria-hidden="true">💬</span>
      <span>Chat with support</span>
    </button>
  );
}
