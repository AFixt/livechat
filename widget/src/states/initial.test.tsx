import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InitialState } from './initial.js';

describe('InitialState', () => {
  it('exposes a single accessible "Chat with support" button', () => {
    render(<InitialState onOpen={() => undefined} />);
    expect(screen.getByRole('button', { name: /chat with support/i })).toBeInTheDocument();
  });

  it('invokes onOpen when activated via keyboard', async () => {
    const onOpen = vi.fn();
    render(<InitialState onOpen={onOpen} />);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /chat with support/i })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
