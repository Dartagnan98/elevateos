'use client';

import { useMemo, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { LeadRow } from '@/lib/realestate/messages-db';

interface LeadTableProps {
  rows: LeadRow[];
}

const STAGE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  qualifying: 'secondary',
  active: 'default',
  cold: 'outline',
  closed: 'outline',
};

function formatTimestamp(unixSeconds: number | null): string {
  if (!unixSeconds) return '—';
  const date = new Date(unixSeconds * 1000);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function LeadTable({ rows }: LeadTableProps) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<string>('all');

  const stages = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.stage) set.add(r.stage);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stage !== 'all' && r.stage !== stage) return false;
      if (!q) return true;
      const haystack = [r.display_name, r.handle, r.last_message]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, stage]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {rows.length} leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name, phone, message..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64"
          />
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Last message</TableHead>
              <TableHead className="text-right">Last touch</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                  No leads match.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((row) => (
              <TableRow key={row.handle} className="cursor-pointer">
                <TableCell className="font-medium">
                  {row.display_name ?? row.handle}
                  {row.display_name && (
                    <span className="ml-2 text-xs text-muted-foreground">{row.handle}</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.stage ? (
                    <Badge variant={STAGE_VARIANTS[row.stage] ?? 'outline'}>{row.stage}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                  {row.last_message ?? '—'}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  {formatTimestamp(row.last_message_at)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {row.message_count ?? 0}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
