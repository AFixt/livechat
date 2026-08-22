import { useRef, useState } from 'preact/hooks';

import type { WidgetMessage } from '../types.js';

/** How long after the last keystroke the visitor is considered to have stopped. */
const TYPING_IDLE_MS = 1500;

interface ActiveProps {
  messages: WidgetMessage[];
  onSend: (body: string) => void;
  onEnd: () => void;
  /** Emit a typing start/stop signal to support (debounced by this component). */
  onTyping: (isTyping: boolean) => void;
  /** Whether the support operator is currently typing. */
  peerTyping: boolean;
}

/**
 * State 6 (§5.1.6) — actively chatting. Transcript + compose box.
 * Transcript is `<ol role="log" aria-live="polite">` so screen readers
 * announce new messages; a matching live region announces when support is
 * typing (#80).
 * @param props - Messages + handlers + peer typing flag.
 * @returns The chat panel body.
 */
export function ActiveState(props: ActiveProps): preact.JSX.Element {
  const [draft, setDraft] = useState('');
  const composeRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalling = useRef(false);

  const stopTyping = (): void => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (signalling.current) {
      signalling.current = false;
      props.onTyping(false);
    }
  };

  const onDraftInput = (value: string): void => {
    setDraft(value);
    if (value.trim() === '') {
      stopTyping();
      return;
    }
    if (!signalling.current) {
      signalling.current = true;
      props.onTyping(true);
    }
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    if (draft.trim() === '') return;
    stopTyping();
    props.onSend(draft.trim());
    setDraft('');
    composeRef.current?.focus();
  };

  return (
    <div>
      <ol class="transcript" role="log" aria-live="polite" aria-label="Chat transcript">
        {props.messages.map((m) => (
          <li key={m.id} class={m.senderKind === 'visitor' ? 'from-visitor' : 'from-user'}>
            {m.body}
          </li>
        ))}
      </ol>
      <p class="typing-indicator" role="status" aria-live="polite">
        {props.peerTyping ? 'Support is typing…' : ''}
      </p>
      <form class="stack" onSubmit={onSubmit}>
        <label class="field">
          <span>Message</span>
          <input
            ref={composeRef}
            type="text"
            value={draft}
            onInput={(e) => {
              onDraftInput(e.currentTarget.value);
            }}
            onBlur={stopTyping}
          />
        </label>
        <button type="submit" class="primary">
          Send
        </button>
      </form>
      <button type="button" onClick={props.onEnd} aria-label="End chat">
        End chat
      </button>
    </div>
  );
}
