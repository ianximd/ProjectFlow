import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    template: '%s | ProjectFlow',
    default: 'ProjectFlow',
  },
  description: 'Modern project management for engineering teams',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className={cn(
          'antialiased flex h-full text-base text-foreground bg-background',
          inter.className,
        )}
      >
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
            <Providers>
              <Suspense>{children}</Suspense>
            </Providers>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
