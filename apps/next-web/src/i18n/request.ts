import { getRequestConfig } from 'next-intl/server';

// Stub — replaced with the real cookie-driven resolver in Task 3.
export default getRequestConfig(async () => ({
  locale: 'en',
  messages: {},
}));
