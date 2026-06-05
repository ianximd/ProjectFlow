import { ReactNode, useEffect, useState, useTransition } from 'react';
import {
  BetweenHorizontalStart,
  Coffee,
  CreditCard,
  FileText,
  Globe,
  IdCard,
  Moon,
  Settings,
  Shield,
  SquareCode,
  UserCircle,
  Users,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { logout } from '@/server/actions/auth';
import { setLocale } from '@/server/actions/locale';
import type { AppLocale } from '@/i18n/locale';
import { useLayout } from '@/components/layouts/layout-1/components/context';
import { toAbsoluteUrl } from '@/lib/helpers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function userInitials(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const I18N_LANGUAGES: { code: AppLocale; flag: string }[] = [
  { code: 'en', flag: toAbsoluteUrl('/media/flags/united-states.svg') },
  { code: 'id', flag: toAbsoluteUrl('/media/flags/indonesia.svg') },
];

const LOCALE_LABEL_KEY: Record<AppLocale, string> = { en: 'english', id: 'indonesian' };

export function UserDropdownMenu({ trigger }: { trigger: ReactNode }) {
  const t = useTranslations('Common');
  const locale = useLocale();
  const activeLanguage =
    I18N_LANGUAGES.find((l) => l.code === locale) ?? I18N_LANGUAGES[0];
  const { theme, setTheme } = useTheme();
  const { user } = useLayout();
  const [, startLogout] = useTransition();
  const [, startLocale] = useTransition();

  // Persist the UI language choice via Server Action; revalidatePath('/', 'layout')
  // re-renders server components with the new catalog.
  const changeLocale = (nextLocale: AppLocale) =>
    startLocale(async () => {
      await setLocale(nextLocale);
    });

  const displayName = user?.name ?? 'Account';
  const email       = user?.email ?? '';
  const avatarUrl   = user?.avatarUrl ?? null;
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => { setAvatarBroken(false); }, [avatarUrl]);

  const handleThemeToggle = (checked: boolean) => {
    setTheme(checked ? 'dark' : 'light');
  };

  // Logout via Server Action: it clears the session cookies server-side and
  // redirects to /login. No in-memory store or react-query cache to clear.
  const handleLogout = () => startLogout(async () => { await logout(); });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" side="bottom" align="end">
        {/* Header */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2 min-w-0">
            {avatarUrl && !avatarBroken ? (
              <img
                className="size-9 rounded-full border-2 border-green-500 object-cover"
                src={avatarUrl}
                alt={displayName}
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <div
                className="size-9 rounded-full border-2 border-green-500 bg-muted text-foreground text-xs font-medium flex items-center justify-center"
                aria-hidden="true"
              >
                {userInitials(displayName)}
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <Link
                href="/settings/profile"
                className="text-sm text-mono hover:text-primary font-semibold truncate"
              >
                {displayName}
              </Link>
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="text-xs text-muted-foreground hover:text-primary truncate"
                >
                  {email}
                </a>
              )}
            </div>
          </div>
          <Badge variant="primary" appearance="light" size="sm">
            Pro
          </Badge>
        </div>

        <DropdownMenuSeparator />

        {/* Menu Items */}
        <DropdownMenuItem asChild>
          <Link
            href="#"
            className="flex items-center gap-2"
          >
            <IdCard />
            Public Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href="/settings/profile"
            className="flex items-center gap-2"
          >
            <UserCircle />
            My Profile
          </Link>
        </DropdownMenuItem>

        {/* My Account Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2">
            <Settings />
            My Account
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuItem asChild>
              <Link
                href="#"
                className="flex items-center gap-2"
              >
                <Coffee />
                Get Started
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="#"
                className="flex items-center gap-2"
              >
                <FileText />
                My Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="#"
                className="flex items-center gap-2"
              >
                <CreditCard />
                Billing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="#"
                className="flex items-center gap-2"
              >
                <Shield />
                Security
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="#"
                className="flex items-center gap-2"
              >
                <Users />
                Members & Roles
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="#"
                className="flex items-center gap-2"
              >
                <BetweenHorizontalStart />
                Integrations
              </Link>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem asChild>
          <Link
            href="https://devs.keenthemes.com"
            className="flex items-center gap-2"
          >
            <SquareCode />
            Dev Forum
          </Link>
        </DropdownMenuItem>

        {/* Language Submenu with Radio Group */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2 [&_[data-slot=dropdown-menu-sub-trigger-indicator]]:hidden hover:[&_[data-slot=badge]]:border-input data-[state=open]:[&_[data-slot=badge]]:border-input">
            <Globe />
            <span className="flex items-center justify-between gap-2 grow relative">
              {t('language')}
              <Badge
                variant="outline"
                className="absolute end-0 top-1/2 -translate-y-1/2"
              >
                {t(LOCALE_LABEL_KEY[activeLanguage.code])}
                <img
                  src={activeLanguage.flag}
                  className="w-3.5 h-3.5 rounded-full"
                  alt={t(LOCALE_LABEL_KEY[activeLanguage.code])}
                />
              </Badge>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(next) => changeLocale(next as AppLocale)}
            >
              {I18N_LANGUAGES.map((item) => (
                <DropdownMenuRadioItem
                  key={item.code}
                  value={item.code}
                  className="flex items-center gap-2"
                >
                  <img
                    src={item.flag}
                    className="w-4 h-4 rounded-full"
                    alt={t(LOCALE_LABEL_KEY[item.code])}
                  />
                  <span>{t(LOCALE_LABEL_KEY[item.code])}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Footer */}
        <DropdownMenuItem
          className="flex items-center gap-2"
          onSelect={(event) => event.preventDefault()}
        >
          <Moon />
          <div className="flex items-center gap-2 justify-between grow">
            Dark Mode
            <Switch
              size="sm"
              checked={theme === 'dark'}
              onCheckedChange={handleThemeToggle}
            />
          </div>
        </DropdownMenuItem>
        <div className="p-2 mt-1">
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
