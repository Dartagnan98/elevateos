'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOrg } from '@/hooks/use-org';
import {
  IconLayoutDashboard,
  IconRobot,
  IconListCheck,
  IconShieldCheck,
  IconActivity,
  IconChartDots3,
  IconFlask,
  IconBook2,
  IconPuzzle,
  IconSettings,
  IconSearch,
  IconClock,
  IconTarget,
  IconMessages,
  IconUsers,
  IconSend,
  IconBriefcase,
  IconAffiliate,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: number;
  section?: string;
  tourId: string;
}

const navItems: NavItem[] = [
  // Core
  { label: 'Overview', href: '/', icon: IconLayoutDashboard, section: 'core', tourId: 'nav-overview' },
  { label: 'Leads', href: '/leads', icon: IconUsers, section: 'core', tourId: 'nav-leads' },
  { label: 'Deals', href: '/deals', icon: IconBriefcase, section: 'core', tourId: 'nav-deals' },
  { label: 'Outreach', href: '/outreach', icon: IconSend, section: 'core', tourId: 'nav-outreach' },
  { label: 'Agents', href: '/agents', icon: IconRobot, section: 'core', tourId: 'nav-agents' },
  { label: 'Tasks', href: '/tasks', icon: IconListCheck, section: 'core', tourId: 'nav-tasks' },
  { label: 'Activity', href: '/activity', icon: IconActivity, section: 'core', tourId: 'nav-activity' },

  // Operations
  { label: 'Comms', href: '/comms', icon: IconMessages, section: 'ops', tourId: 'nav-comms' },
  { label: 'Approvals', href: '/approvals', icon: IconShieldCheck, section: 'ops', tourId: 'nav-approvals' },
  { label: 'Workflows', href: '/workflows', icon: IconClock, section: 'ops', tourId: 'nav-workflows' },
  { label: 'Strategy', href: '/strategy', icon: IconTarget, section: 'ops', tourId: 'nav-strategy' },
  { label: 'Analytics', href: '/analytics', icon: IconChartDots3, section: 'ops', tourId: 'nav-analytics' },

  // Intelligence
  { label: 'Knowledge Base', href: '/knowledge-base', icon: IconBook2, section: 'intel', tourId: 'nav-knowledge-base' },
  { label: 'Memory Graph', href: '/memory-graph', icon: IconAffiliate, section: 'intel', tourId: 'nav-memory-graph' },
  { label: 'Experiments', href: '/experiments', icon: IconFlask, section: 'intel', tourId: 'nav-experiments' },
  { label: 'Skills', href: '/skills', icon: IconPuzzle, section: 'intel', tourId: 'nav-skills' },
];

const sectionLabels: Record<string, string> = {
  core: '',
  ops: 'Operations',
  intel: 'Intelligence',
};

interface SidebarProps {
  pendingApprovals?: number;
  inProgressTasks?: number;
  onNavigate?: () => void;
  onSearchClick?: () => void;
}

export function Sidebar({
  pendingApprovals = 0,
  inProgressTasks = 0,
  onNavigate,
  onSearchClick,
}: SidebarProps) {
  const pathname = usePathname();
  const { currentOrg } = useOrg();

  function orgHref(href: string) {
    if (currentOrg && currentOrg !== 'all') {
      return `${href}${href.includes('?') ? '&' : '?'}org=${encodeURIComponent(currentOrg)}`;
    }
    return href;
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  function getBadge(item: NavItem): number {
    if (item.href === '/approvals') return pendingApprovals;
    if (item.href === '/tasks') return inProgressTasks;
    return 0;
  }

  // Group items by section
  const sections = ['core', 'ops', 'intel'];

  return (
    <aside data-tour="sidebar" className="flex h-screen w-56 shrink-0 flex-col border-r bg-card/50">
      {/* Logo */}
      <div className="flex h-[60px] items-center justify-center px-4">
        <Image
          src="/elevateos-wordmark.png"
          alt="ElevateOS"
          width={210}
          height={70}
          priority
          className="h-auto w-[144px] object-contain dark:hidden"
        />
        <Image
          src="/elevateos-wordmark-dark.png"
          alt="ElevateOS"
          width={210}
          height={70}
          priority
          className="hidden h-auto w-[144px] object-contain dark:block"
        />
      </div>

      {/* Search trigger */}
      <div className="px-3 pb-2">
        <button
          onClick={onSearchClick}
          data-tour="global-search"
          className="flex w-full items-center gap-2 rounded-md border bg-background/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
        >
          <IconSearch size={14} />
          <span>Search...</span>
          <kbd className="ml-auto rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">
            /
          </kbd>
        </button>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-2">
        {sections.map((section) => {
          const items = navItems.filter((i) => i.section === section);
          const label = sectionLabels[section];

          return (
            <div key={section} className="mb-1">
              {label && (
                <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {label}
                </p>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                const badge = getBadge(item);

                return (
                  <Link
                    key={item.href}
                    href={orgHref(item.href)}
                    onClick={onNavigate}
                    data-tour={item.tourId}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-all',
                      active
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    <Icon
                      size={16}
                      className={cn(
                        'shrink-0 transition-colors',
                        active ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {badge > 0 && (
                      <Badge
                        variant={active ? 'default' : 'secondary'}
                        className="ml-auto h-4.5 min-w-5 px-1 text-[10px] font-medium"
                      >
                        {badge}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <Separator />

      {/* Settings at bottom */}
      <div className="px-2 py-2">
        <Link
          href={orgHref('/settings')}
          onClick={onNavigate}
          data-tour="settings-link"
          className={cn(
            'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-all',
            isActive('/settings')
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <IconSettings size={16} className="shrink-0" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
