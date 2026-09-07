import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function loadTelegramConfig(): { token: string; chatId: string } {
  // Try env vars first
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_HOME_CHANNEL ?? '781388509';
  if (token) return { token, chatId };

  // Fallback: read from hermes .env
  try {
    const envPath = path.join(homedir(), '.hermes', '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('TELEGRAM_BOT_TOKEN=') && !trimmed.startsWith('#')) {
        return { token: trimmed.slice('TELEGRAM_BOT_TOKEN='.length), chatId };
      }
    }
  } catch {}
  return { token: '', chatId };
}

export async function sendTelegram(text: string): Promise<void> {
  const { token, chatId } = loadTelegramConfig();
  if (!token) {
    console.error('[notify] no TELEGRAM_BOT_TOKEN found');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const data = await res.json() as any;
    if (!data.ok) console.error('[notify] telegram error:', data.description);
  } catch (e) {
    console.error('[notify] telegram failed:', (e as Error).message);
  }
}

export function taskStatusMessage(title: string, status: string, reason?: string | null): string {
  switch (status) {
    case 'in_progress':
      return `Hey! Task Agent-Kanban : <b>${escHtml(title)}</b> sedang dikerjain`;
    case 'done':
      return `Hey! Task Agent-Kanban : <b>${escHtml(title)}</b> sudah beres`;
    case 'rejected':
      return `Hey! Task Agent-Kanban : <b>${escHtml(title)}</b> Ditolak${reason ? `\nReason: ${escHtml(reason)}` : ''}`;
    default:
      return '';
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
