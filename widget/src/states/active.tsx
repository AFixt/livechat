import { useRef, useState } from 'preact/hooks';

import type { WidgetMessage } from '../types.js';

interface ActiveProps {
  messages: WidgetMessage[];
  onSend: (body: string) => void;
  onEnd: () => void;
}

/**
 * State 6 (§5.1.6) — actively chatting. Transcript + compose box.
 * Transcript is `<ol role="log" aria-live="polite">` so screen readers
 * announce new messages.
 * @param props - Messages + handlers.
 * @returns The chat panel body.
 */
export function ActiveState(props: ActiveProps): preact.JSX.Element {
  const [draft, setDraft] = useState('');
  const composeRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    if (draft.trim() === '') return;
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
      <form class="stack" onSubmit={onSubmit}>
        <label class="field">
          <span>Message</span>
          <input
            ref={composeRef}
            type="text"
            value={draft}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
            }}
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
