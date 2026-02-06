import { AgentMailClient } from 'agentmail';

function env(name: string) {
  return process.env[name] ?? '';
}

let _client: AgentMailClient | null = null;
function client() {
  if (_client) return _client;
  const apiKey = env('AGENTMAIL_API_KEY');
  if (!apiKey) return null;
  _client = new AgentMailClient({ apiKey });
  return _client;
}

export async function sendMail(params: {
  fromInboxId?: string; // e.g. playclawarena@agentmail.to
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | string[];
}) {
  const c = client();
  if (!c) {
    // In dev/test without AgentMail configured, silently no-op.
    // (Avoid logging user emails / codes.)
    return { ok: false as const, skipped: true as const };
  }

  const fromInboxId = params.fromInboxId || env('OWNER_VERIFY_FROM') || env('AGENTMAIL_FROM') || 'playclawarena@agentmail.to';

  await c.inboxes.messages.send(fromInboxId, {
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    reply_to: params.replyTo
  } as any);

  return { ok: true as const };
}
