'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IconLoader2 } from '@tabler/icons-react';

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const TIERS = [
  { value: 'specialist', label: 'Specialist' },
  { value: 'primary', label: 'Primary' },
] as const;

type Tier = (typeof TIERS)[number]['value'];

export function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateAgentDialogProps) {
  const [agentId, setAgentId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [org, setOrg] = useState('standalone');
  const [tier, setTier] = useState<Tier>('specialist');
  const [reportsTo, setReportsTo] = useState('executive-assistant');
  const [role, setRole] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function resetForm() {
    setAgentId('');
    setDisplayName('');
    setOrg('standalone');
    setTier('specialist');
    setReportsTo('executive-assistant');
    setRole('');
    setError(null);
    setSuccess(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function validate(): string | null {
    if (!displayName.trim()) return 'Display name is required.';
    if (agentId.trim() && !NAME_PATTERN.test(agentId))
      return 'Agent ID must be lowercase alphanumeric, hyphens, or underscores (cannot start with - or _).';
    if (!org.trim()) return 'Organization is required.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/elevate/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId.trim() || undefined,
          display_name: displayName.trim(),
          org: org.trim(),
          tier,
          reports_to: tier === 'primary' ? null : reportsTo.trim() || 'executive-assistant',
          role: role.trim(),
          lane: displayName.trim(),
          enabled: true,
          status: 'ready',
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to create agent (${res.status})`);
      }

      setSuccess(true);
      onCreated?.();

      // Auto-close after brief delay so user sees the success message
      setTimeout(() => handleOpenChange(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>
            Add a visible Elevate orchestration agent to the local gateway roster.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-display-name">Display Name</Label>
            <Input
              id="agent-display-name"
              placeholder="Transaction Coordinator"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="agent-id">Agent ID</Label>
            <Input
              id="agent-id"
              placeholder="transaction-coordinator"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value.toLowerCase())}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to generate it from the display name. Keep this stable once the agent has runs or memory.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="agent-org">Organization</Label>
              <Input
                id="agent-org"
                placeholder="standalone"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="agent-tier">Tier</Label>
              <select
                id="agent-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value as Tier)}
                disabled={submitting}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {tier !== 'primary' && (
            <div className="grid gap-1.5">
              <Label htmlFor="agent-reports-to">Reports To</Label>
              <Input
                id="agent-reports-to"
                placeholder="executive-assistant"
                value={reportsTo}
                onChange={(e) => setReportsTo(e.target.value.toLowerCase())}
                disabled={submitting}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="agent-role">Role</Label>
            <Input
              id="agent-role"
              placeholder="Handles listings, follow-up, or marketing workflows"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Feedback */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {success && (
            <p className="text-sm text-green-600">Agent created!</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
