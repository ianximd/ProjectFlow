import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../../../messages/en.json';

// next/link needs the App Router context at runtime; render a plain anchor in tests.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) =>
    React.createElement('a', { href: typeof href === 'string' ? href : String(href), ...rest }, children),
}));

// Mock the server action so the panel runs fully client-side in jsdom.
vi.mock('@/server/actions/ai', () => ({ askAi: vi.fn() }));
import { askAi } from '@/server/actions/ai';
import { AskAiPanel } from '../AskAiPanel';

const mockAsk = vi.mocked(askAi);

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AskAiPanel workspaceId="ws-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => mockAsk.mockReset());

describe('AskAiPanel', () => {
  it('renders the answer and citation links after asking', async () => {
    mockAsk.mockResolvedValue({
      answer: 'Launch slips to Q3 [1].',
      citations: [{ objectType: 'task', objectId: 't1' }],
    });
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Ask AI'), 'what is at risk?');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));

    expect(await screen.findByText('Launch slips to Q3 [1].')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /t1/ });
    expect(link).toHaveAttribute('href', '/tasks/t1');
    expect(mockAsk).toHaveBeenCalledWith('ws-1', 'what is at risk?');
  });

  it('renders only the answer when there are no citations', async () => {
    mockAsk.mockResolvedValue({ answer: 'No relevant sources found.', citations: [] });
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Ask AI'), 'unrelated question');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));

    expect(await screen.findByText('No relevant sources found.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
