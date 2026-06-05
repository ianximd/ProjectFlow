import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';
import { getLocale, getMessages } from 'next-intl/server';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { IntlProvider } from '@/components/providers/IntlProvider';
import { ApolloRealtimeProvider } from '@/components/providers/ApolloRealtimeProvider';
import { cn } from '@/lib/utils';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    template: '%s | ProjectFlow',
    default: 'ProjectFlow',
  },
  description: 'Modern project management for engineering teams',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <html lang={locale} className="h-full" suppressHydrationWarning>
      <body
        className={cn(
          'antialiased flex h-full text-base text-foreground bg-background',
          inter.className,
        )}
      >
        <IntlProvider locale={locale} messages={messages}>
          <ApolloRealtimeProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              storageKey="projectflow-theme"
              enableSystem
              disableTransitionOnChange
              enableColorScheme
            >
              <TooltipProvider delayDuration={0}>
                <a href="#main-content" className="skip-link">
                  Skip to main content
                </a>
                <Suspense>{children}</Suspense>
                <Toaster />
              </TooltipProvider>
            </ThemeProvider>
          </ApolloRealtimeProvider>
        </IntlProvider>
      </body>
    </html>
  );
}
