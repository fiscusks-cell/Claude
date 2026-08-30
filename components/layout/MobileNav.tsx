'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { DashboardNav } from '@/components/layout/DashboardNav';
import { OraLogo } from '@/components/layout/OraLogo';

interface MobileNavProps {
  user: {
    name: string;
    email: string;
    role: string;
    organizationName: string;
    image?: string | null;
  };
}

export function MobileNav({ user }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
          style={{ color: 'var(--sidebar-text)' }}
          aria-label="Open navigation menu"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-item-hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-60 p-0 flex flex-col"
        style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' } as React.CSSProperties}
      >
        {/* Logo */}
        <div className="p-6 flex-shrink-0" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
          <OraLogo />
        </div>
        {/* Nav — closes sheet on link click */}
        <div className="flex flex-col flex-1 overflow-hidden" onClick={() => setOpen(false)}>
          <DashboardNav user={user} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
