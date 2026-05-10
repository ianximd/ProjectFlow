import { ChevronFirst } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useLayout } from './context';
import Link from 'next/link';

export function SidebarHeader() {
  const { sidebarCollapse, setSidebarCollapse } = useLayout();

  return (
    <div className="sidebar-header hidden lg:flex items-center relative justify-between px-3 lg:px-6 shrink-0">
      <Link href="/board" className="flex items-center gap-2">
        <div
          className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground font-bold text-xs"
          aria-hidden="true"
        >
          PF
        </div>
        <span className="text-base font-semibold text-foreground default-logo">
          ProjectFlow
        </span>
      </Link>
      <Button
        onClick={() => setSidebarCollapse(!sidebarCollapse)}
        size="sm"
        mode="icon"
        variant="outline"
        className={cn(
          'size-7 absolute start-full top-2/4 rtl:translate-x-2/4 -translate-x-2/4 -translate-y-2/4',
          sidebarCollapse ? 'ltr:rotate-180' : 'rtl:rotate-180',
        )}
      >
        <ChevronFirst className="size-4!" />
      </Button>
    </div>
  );
}
