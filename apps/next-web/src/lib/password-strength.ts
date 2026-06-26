export type PasswordStrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  level: PasswordStrengthLevel;
}

/**
 * Advisory password strength. Length is the hard gate: anything under 8 chars
 * is always weak. At >= 8 chars the score reflects how many character classes
 * (lowercase, uppercase, digit, symbol) appear.
 */
export function scorePassword(password: string): PasswordStrength {
  if (password.length === 0) return { score: 0, level: 'weak' };
  if (password.length < 8) return { score: 1, level: 'weak' };

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  const variety = classes.reduce((n, re) => (re.test(password) ? n + 1 : n), 0);

  if (variety <= 1) return { score: 1, level: 'weak' };
  if (variety === 2) return { score: 2, level: 'fair' };
  if (variety === 3) return { score: 3, level: 'good' };
  return { score: 4, level: 'strong' };
}
