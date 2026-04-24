interface RestartProps {
  onRestart: () => void;
}

/**
 * State 8 (§5.1.8) — visitor re-opened the widget within the same session
 * after closing it. Offers a single "Resume chat" button that returns to
 * the active state.
 * @param props - Restart callback.
 * @returns The restart panel.
 */
export function RestartState(props: RestartProps): preact.JSX.Element {
  return (
    <div>
      <p>Welcome back. Continue your conversation?</p>
      <button type="button" class="primary" onClick={props.onRestart}>
        Resume chat
      </button>
    </div>
  );
}
