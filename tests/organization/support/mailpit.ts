// #1646 — the browser gate runs a disposable mailpit container as the SMTP
// sink. These helpers read it through its HTTP API (loopback only).
import { required } from './api';

interface MailpitAddress { Address: string }
interface MailpitSummary { ID: string; Subject: string; To: MailpitAddress[] }
interface MailpitMessage { ID: string; Subject: string; Text: string; HTML: string; To: MailpitAddress[] }

function apiBase(): string {
  return required('ORGANIZATION_MAILPIT_API').replace(/\/$/, '');
}

export async function mailboxFor(address: string): Promise<MailpitSummary[]> {
  const response = await fetch(`${apiBase()}/api/v1/messages?limit=200`);
  if (!response.ok) throw new Error(`mailpit list failed: ${response.status}`);
  const payload = (await response.json()) as { messages: MailpitSummary[] };
  const wanted = address.toLowerCase();
  return payload.messages.filter((message) => message.To.some((to) => to.Address.toLowerCase() === wanted));
}

export async function readMessage(id: string): Promise<MailpitMessage> {
  const response = await fetch(`${apiBase()}/api/v1/message/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`mailpit read failed: ${response.status}`);
  return (await response.json()) as MailpitMessage;
}

/** Polls until `count` messages for `address` match `subject`, then returns the newest. */
export async function waitForMessage(address: string, subject: RegExp, count = 1, timeoutMs = 30_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const matching = (await mailboxFor(address)).filter((message) => subject.test(message.Subject));
    if (matching.length >= count) return readMessage(matching[0]!.ID);
    if (Date.now() > deadline) throw new Error(`no email "${subject}" for ${address} after ${timeoutMs}ms (found ${matching.length})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Extracts the single absolute link to `path` from a plain-text body. */
export function linkTo(text: string, path: string): string {
  const links = text.match(/https?:\/\/\S+/g) ?? [];
  const found = links.filter((link) => new URL(link).pathname === path);
  if (found.length !== 1) throw new Error(`expected exactly one ${path} link, found ${found.length}`);
  return found[0]!;
}
