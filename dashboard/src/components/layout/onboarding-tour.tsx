'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconArrowLeft,
  IconArrowRight,
  IconMap2,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type TourStep = {
  id: string;
  target: string;
  eyebrow: string;
  title: string;
  body: string;
};

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const STORAGE_KEY = 'elevate-onboarding-seen';

const TOUR_STEPS: TourStep[] = [
  {
    id: 'workspace',
    target: '[data-tour="workspace"]',
    eyebrow: 'Start here',
    title: 'Overview is the daily command center',
    body: 'This is where new leads, deals, follow-ups, agent tasks, and source issues should roll up once connectors are working.',
  },
  {
    id: 'sidebar',
    target: '[data-tour="sidebar"]',
    eyebrow: 'Navigation',
    title: 'The left rail maps the real estate workflow',
    body: 'The sidebar is the product map. Each section is a different operating surface for a real estate team and the agents supporting them.',
  },
  {
    id: 'search',
    target: '[data-tour="global-search"]',
    eyebrow: 'Find things',
    title: 'Search is the fast lane back to work',
    body: 'Use this as the eventual jump point for people, deals, tasks, source records, documents, and agent activity.',
  },
  {
    id: 'nav-overview',
    target: '[data-tour="nav-overview"]',
    eyebrow: 'Sidebar feature',
    title: 'Overview shows the day at a glance',
    body: 'This is the operator dashboard: replies needed, deals at risk, deadlines, admin work, and source health should surface here first.',
  },
  {
    id: 'nav-leads',
    target: '[data-tour="nav-leads"]',
    eyebrow: 'Sidebar feature',
    title: 'Leads is the intake lane',
    body: 'Qualified opportunities from CRM, forms, SMS, email, and social DMs should land here with source context and next-step status.',
  },
  {
    id: 'nav-deals',
    target: '[data-tour="nav-deals"]',
    eyebrow: 'Sidebar feature',
    title: 'Deals tracks active transactions',
    body: 'Use this for listings, buyers, deadlines, feedback, documents, blockers, and anything that can stall a contract or closing.',
  },
  {
    id: 'nav-outreach',
    target: '[data-tour="nav-outreach"]',
    eyebrow: 'Sidebar feature',
    title: 'Outreach is where follow-up gets drafted',
    body: 'This is the queue for lead follow-up, listing updates, nurture messages, and agent-written drafts that need review before sending.',
  },
  {
    id: 'nav-agents',
    target: '[data-tour="nav-agents"]',
    eyebrow: 'Sidebar feature',
    title: 'Agents shows the Elevate workers',
    body: 'Configure and inspect the agents here: their goals, memory, schedules, logs, and the runtime connection behind each workflow.',
  },
  {
    id: 'nav-tasks',
    target: '[data-tour="nav-tasks"]',
    eyebrow: 'Sidebar feature',
    title: 'Tasks is the shared work queue',
    body: 'Human tasks and agent-created tasks should meet here so nothing depends on remembering which tool created the work.',
  },
  {
    id: 'nav-activity',
    target: '[data-tour="nav-activity"]',
    eyebrow: 'Sidebar feature',
    title: 'Activity is the audit trail',
    body: 'This should answer what happened, which source or agent did it, and what still needs a person to approve or correct.',
  },
  {
    id: 'nav-comms',
    target: '[data-tour="nav-comms"]',
    eyebrow: 'Sidebar feature',
    title: 'Comms is the conversation surface',
    body: 'Messages from SMS, email, CRM inboxes, and social channels should be normalized here without forcing every customer into one provider.',
  },
  {
    id: 'nav-approvals',
    target: '[data-tour="nav-approvals"]',
    eyebrow: 'Sidebar feature',
    title: 'Approvals is the safety gate',
    body: 'Anything that sends, changes a customer record, updates a deal, or touches a sensitive source should wait here for a human decision.',
  },
  {
    id: 'nav-workflows',
    target: '[data-tour="nav-workflows"]',
    eyebrow: 'Sidebar feature',
    title: 'Workflows are repeatable operating loops',
    body: 'Use workflows for repeatable sequences like new lead response, listing feedback review, deadline checks, and document follow-up.',
  },
  {
    id: 'nav-strategy',
    target: '[data-tour="nav-strategy"]',
    eyebrow: 'Sidebar feature',
    title: 'Strategy holds goals and market context',
    body: 'This is where business goals, market stats, campaign priorities, and operating preferences can shape what the agents recommend.',
  },
  {
    id: 'nav-analytics',
    target: '[data-tour="nav-analytics"]',
    eyebrow: 'Sidebar feature',
    title: 'Analytics shows whether the system is working',
    body: 'Track response time, lead conversion, stale deals, source coverage, agent throughput, and approval volume from this surface.',
  },
  {
    id: 'nav-knowledge-base',
    target: '[data-tour="nav-knowledge-base"]',
    eyebrow: 'Sidebar feature',
    title: 'Knowledge Base stores the local operating memory',
    body: 'Docs, forms, market notes, team preferences, and source-specific instructions should live here so agents have grounded context.',
  },
  {
    id: 'nav-experiments',
    target: '[data-tour="nav-experiments"]',
    eyebrow: 'Sidebar feature',
    title: 'Experiments is the testing lane',
    body: 'Use this area to trial new prompts, connectors, automations, and agent behaviors before they become part of the live workflow.',
  },
  {
    id: 'nav-skills',
    target: '[data-tour="nav-skills"]',
    eyebrow: 'Sidebar feature',
    title: 'Skills are the productized capabilities',
    body: 'Each skill should describe what it needs, what sources it can use, and how it connects back into the dashboard and approval flow.',
  },
  {
    id: 'topbar',
    target: '[data-tour="topbar"]',
    eyebrow: 'Context',
    title: 'The top bar controls operating context',
    body: 'Switch org scope here, change theme, and use the account menu. A customer install should feel scoped before any agent starts acting.',
  },
  {
    id: 'settings',
    target: '[data-tour="settings-link"]',
    eyebrow: 'Setup',
    title: 'Settings is where connectors become real',
    body: 'Use Elevate Agent for runtime setup, Integrations for APIs, and Source Connectors to create or check the data pipes feeding the UI.',
  },
  {
    id: 'loop',
    target: '[data-tour="workspace"]',
    eyebrow: 'Operating loop',
    title: 'Connect sources, review, then act with approvals',
    body: 'The product loop is: connect customer sources, normalize records, surface next actions, draft safely, then approve before sending or changing anything.',
  },
];

function getTargetRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function OnboardingTour() {
  const [promptOpen, setPromptOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const activeStep = activeIndex === null ? null : TOUR_STEPS[activeIndex];
  const running = activeStep !== null;

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Storage can be unavailable in strict browser modes; the tour still works.
    }
  }, []);

  const closeTour = useCallback((seen = false) => {
    if (seen) markSeen();
    setActiveIndex(null);
    setRect(null);
  }, [markSeen]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        if (localStorage.getItem(STORAGE_KEY) !== 'true') setPromptOpen(true);
      } catch {
        setPromptOpen(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const refreshRect = useCallback(() => {
    if (!activeStep) return;
    setRect(getTargetRect(activeStep.target));
  }, [activeStep]);

  useEffect(() => {
    if (!activeStep) return;
    const target = document.querySelector(activeStep.target);
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const frame = window.requestAnimationFrame(refreshRect);
    window.addEventListener('resize', refreshRect);
    window.addEventListener('scroll', refreshRect, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refreshRect);
      window.removeEventListener('scroll', refreshRect, true);
    };
  }, [activeStep, refreshRect]);

  useEffect(() => {
    if (!running) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeTour(true);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTour, running]);

  const popoverStyle = useMemo<CSSProperties>(() => {
    if (typeof window === 'undefined') return {};
    const width = Math.min(390, window.innerWidth - 32);
    if (!rect) {
      return {
        width,
        left: (window.innerWidth - width) / 2,
        top: Math.max(80, window.innerHeight / 2 - 160),
      };
    }
    const below = rect.top + rect.height + 16;
    const above = rect.top - 250;
    return {
      width,
      left: clamp(rect.left, 16, window.innerWidth - width - 16),
      top: below < window.innerHeight - 250 ? below : clamp(above, 16, window.innerHeight - 280),
    };
  }, [rect]);

  function startTour() {
    setPromptOpen(false);
    setActiveIndex(0);
  }

  function finishTour() {
    closeTour(true);
  }

  return (
    <>
      {promptOpen && !running && (
        <div className="fixed bottom-20 right-4 z-[80] w-[min(360px,calc(100vw-2rem))] rounded-md border bg-background p-4 shadow-xl md:bottom-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <IconSparkles size={16} />
                New to ElevateOS?
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Run the onboarding tour to see where sources, agents, deals, outreach, and approvals fit.
              </p>
            </div>
            <button
              type="button"
              className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                markSeen();
                setPromptOpen(false);
              }}
              aria-label="Dismiss onboarding prompt"
            >
              <IconX size={16} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={startTour}>
              <IconMap2 size={16} />
              Run onboarding
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                markSeen();
                setPromptOpen(false);
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      )}

      {running && activeStep && (
        <div className="fixed inset-0 z-[90]">
          {rect && (
            <div
              className="pointer-events-none absolute rounded-lg border-2 border-primary bg-primary/5 ring-4 ring-primary/15 transition-all duration-200"
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
            />
          )}
          <div
            className="absolute rounded-md border bg-background p-4 shadow-2xl"
            style={popoverStyle}
            role="dialog"
            aria-modal="true"
            aria-label="ElevateOS onboarding"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge variant="outline">
                  {(activeIndex ?? 0) + 1} of {TOUR_STEPS.length}
                </Badge>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {activeStep.eyebrow}
                </p>
                <h2 className="mt-1 text-base font-semibold">{activeStep.title}</h2>
              </div>
              <button
                type="button"
                className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => closeTour(true)}
                aria-label="Close onboarding"
              >
                <IconX size={17} />
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{activeStep.body}</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex((index) => Math.max((index ?? 0) - 1, 0))}
              >
                <IconArrowLeft size={16} />
                Back
              </Button>
              <div className="flex gap-1">
                {TOUR_STEPS.map((step, index) => (
                  <span
                    key={step.id}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      index === activeIndex ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                    )}
                  />
                ))}
              </div>
              {activeIndex === TOUR_STEPS.length - 1 ? (
                <Button type="button" size="sm" onClick={finishTour}>
                  Done
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setActiveIndex((index) => Math.min((index ?? 0) + 1, TOUR_STEPS.length - 1))}
                >
                  Next
                  <IconArrowRight size={16} />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {!running && !promptOpen && (
        <button
          type="button"
          onClick={startTour}
          className="group fixed bottom-20 right-4 z-[70] flex h-11 max-w-11 items-center gap-2 overflow-hidden rounded-full border bg-background px-3 text-sm font-medium shadow-lg transition-all hover:max-w-64 hover:border-primary/40 hover:text-primary focus-visible:max-w-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:bottom-6"
          aria-label="Run onboarding"
        >
          <IconMap2 size={18} className="shrink-0" />
          <span className="whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Run me through onboarding
          </span>
        </button>
      )}
    </>
  );
}
