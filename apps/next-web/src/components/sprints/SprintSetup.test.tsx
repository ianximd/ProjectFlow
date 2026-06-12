import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../messages/en.json';
import { SprintSetup } from './SprintSetup';

function renderWithIntl(ui: ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

describe('SprintSetup', () => {
  it('renders the cadence + auto-state controls', () => {
    renderWithIntl(
      <SprintSetup
        folderId="f1"
        settings={{ folderId: 'f1', durationDays: 14, startDayOfWeek: null, autoStart: false, autoComplete: false, autoRollForward: false, pointsFieldId: null }}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText(en.Sprints.durationDays)).toBeInTheDocument();
    expect(screen.getByText(en.Sprints.autoComplete)).toBeInTheDocument();
  });
});
