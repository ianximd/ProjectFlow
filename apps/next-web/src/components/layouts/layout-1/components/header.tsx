import { useEffect, useState } from 'react';
import { Bell, Menu, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useScrollPosition } from '@/hooks/use-scroll-position';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SearchDialog } from '@/components/layouts/layout-1/shared/dialogs/search/search-dialog';
import { NotificationsSheet } from '@/components/layouts/layout-1/shared/topbar/notifications-sheet';
import { UserDropdownMenu } from '@/components/layouts/layout-1/shared/topbar/user-dropdown-menu';
import { useStore } from '@/store/useStore';
import { SidebarMenu } from './sidebar-menu';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

// Auth store returns user records with Pascal or camelCase keys depending
// on the endpoint that produced them (SP rows vs. service responses).
function pick<T>(o: any, ...keys: string[]): T | undefined {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null) return o[k] as T;
  return undefined;
}
function initials(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export function Header() {
  const [isSidebarSheetOpen, setIsSidebarSheetOpen] = useState(false);

  const pathname = usePathname();
  const mobileMode = useIsMobile();

  const scrollPosition = useScrollPosition();
  const headerSticky: boolean = scrollPosition > 0;

  // Live avatar — kept in the auth store, refreshed by the profile page's
  // upload/remove mutations via setAuth(). Falls back to initials when the
  // image fails to load (legacy http URL, expired key, MinIO down).
  const user        = useStore((s) => s.user) as Record<string, any> | null;
  const avatarUrl   = pick<string>(user, 'AvatarUrl', 'avatarUrl') ?? null;
  const displayName = pick<string>(user, 'Name', 'name') ?? '';
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => { setAvatarBroken(false); }, [avatarUrl]);

  useEffect(() => {
    setIsSidebarSheetOpen(false);
  }, [pathname]);

  return (
    <header
      className={cn(
        'header fixed top-0 z-10 start-0 flex items-stretch shrink-0 border-b border-transparent bg-background end-0 pe-[var(--removed-body-scroll-bar-size,0px)]',
        headerSticky && 'border-b border-border',
      )}
    >
      <div className="container-fluid flex justify-between items-stretch lg:gap-4">
        {/* Mobile-only logo + sidebar trigger */}
        <div className="flex lg:hidden items-center gap-2.5">
          <Link href="/board" className="shrink-0 flex items-center gap-2">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground font-bold text-xs"
              aria-hidden="true"
            >
              PF
            </div>
            <span className="text-base font-semibold text-foreground">
              ProjectFlow
            </span>
          </Link>
          {mobileMode && (
            <Sheet
              open={isSidebarSheetOpen}
              onOpenChange={setIsSidebarSheetOpen}
            >
              <SheetTrigger asChild>
                <Button variant="ghost" mode="icon">
                  <Menu className="text-muted-foreground/70" />
                </Button>
              </SheetTrigger>
              <SheetContent
                className="p-0 gap-0 w-[275px]"
                side="left"
                close={false}
              >
                <SheetHeader className="p-0 space-y-0" />
                <SheetBody className="p-0 overflow-y-auto">
                  <SidebarMenu />
                </SheetBody>
              </SheetContent>
            </Sheet>
          )}
        </div>

        <div className="hidden lg:block grow" />

        {/* Topbar actions */}
        <div className="flex items-center gap-3">
          {!mobileMode && (
            <SearchDialog
              trigger={
                <Button
                  variant="ghost"
                  mode="icon"
                  shape="circle"
                  className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
                >
                  <Search className="size-4.5!" />
                </Button>
              }
            />
          )}
          <NotificationsSheet
            trigger={
              <Button
                variant="ghost"
                mode="icon"
                shape="circle"
                className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
              >
                <Bell className="size-4.5!" />
              </Button>
            }
          />
          <UserDropdownMenu
            trigger={
              avatarUrl && !avatarBroken ? (
                <img
                  className="size-9 rounded-full border border-border shrink-0 cursor-pointer object-cover"
                  src={avatarUrl}
                  alt={displayName || 'User Avatar'}
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <button
                  type="button"
                  aria-label={displayName ? `${displayName} menu` : 'User menu'}
                  className="size-9 rounded-full border border-border shrink-0 cursor-pointer bg-muted text-foreground text-xs font-medium flex items-center justify-center"
                >
                  {initials(displayName)}
                </button>
              )
            }
          />
        </div>
      </div>
    </header>
  );
}
