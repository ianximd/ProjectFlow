import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const registerMock = vi.fn();
vi.mock('@/server/actions/auth', () => ({
  register: (...args: unknown[]) => registerMock(...args),
}));

import RegisterPage from '../page';

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  registerMock.mockReset();
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }) as unknown as typeof fetch;
});

describe('RegisterPage', () => {
  it('renders name, email, password and confirm-password fields', () => {
    wrap(<RegisterPage />);
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('shows a mismatch error and disables submit when passwords differ', async () => {
    const user = userEvent.setup();
    wrap(<RegisterPage />);
    await user.type(screen.getByLabelText('Full Name'), 'Jane');
    await user.type(screen.getByLabelText('Email address'), 'jane@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1?');
    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled();
  });

  it('toggles the password field between hidden and visible', async () => {
    const user = userEvent.setup();
    wrap(<RegisterPage />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    await user.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(pw.type).toBe('text');
  });

  it('submits valid input and routes to the login page', async () => {
    registerMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    wrap(<RegisterPage />);
    await user.type(screen.getByLabelText('Full Name'), 'Jane');
    await user.type(screen.getByLabelText('Email address'), 'jane@example.com');
    await user.type(screen.getByLabelText('Password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith('jane@example.com', 'Jane', 'Abcdef1!'),
    );
    expect(push).toHaveBeenCalledWith('/login?registered=1');
  });
});
