'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconRefresh, IconSend } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface MessageEntry {
  id: string;
  timestamp: string;
  agent: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string;
  source?: string;
}

interface AgentChatTabProps {
  agentName: string;
  displayName: string;
  health: string;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function AgentChatTab({ agentName, displayName, health }: AgentChatTabProps) {
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/history/${encodeURIComponent(agentName)}?limit=200`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`History failed (${res.status})`);
      const data = await res.json() as MessageEntry[];
      setMessages(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      setLoading(false);
    }
  }, [agentName]);

  useEffect(() => {
    setLoading(true);
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentName, text, type: 'dashboard' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Send failed (${res.status})`);
      setDraft('');
      await fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message');
    } finally {
      setSending(false);
    }
  }

  const online = health === 'healthy' || health === 'starting';

  return (
    <Card>
      <CardContent className="grid h-[min(720px,calc(100vh-220px))] min-h-[520px] gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Talk to {displayName || agentName}</div>
            <div className="text-xs text-muted-foreground">
              Messages go straight to this agent inbox and stay visible in local history.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={online ? 'default' : 'secondary'}>
              {health === 'starting' ? 'Starting' : online ? 'Online' : 'Offline - queued'}
            </Badge>
            <Button variant="ghost" size="icon-sm" onClick={fetchMessages} title="Refresh messages">
              <IconRefresh size={15} />
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 overflow-y-auto rounded-md border bg-muted/15 p-3">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No messages yet. Start the conversation here.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const inbound = message.direction === 'inbound';
                return (
                  <div key={`${message.id}-${message.timestamp}`} className={`flex ${inbound ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm shadow-sm ${
                      inbound
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background'
                    }`}>
                      <div className={`mb-1 text-[10px] font-medium uppercase ${
                        inbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
                      }`}>
                        {inbound ? 'You' : displayName || agentName}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{message.text}</div>
                      <div className={`mt-1 text-right text-[10px] ${
                        inbound ? 'text-primary-foreground/65' : 'text-muted-foreground'
                      }`}>
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className="grid gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder={`Message ${displayName || agentName}...`}
            className="min-h-20 resize-none"
          />
          <div className="flex justify-end">
            <Button onClick={sendMessage} disabled={!draft.trim() || sending}>
              <IconSend size={15} />
              {sending ? 'Sending' : 'Send'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
