// Send only. This repo must never call getUpdates: the LinkedIn engine is the bot's only update reader, and a second
// reader silently eats his button taps (spec W5; a test greps for it).
import { requestJson } from './lib/http.mjs';

export async function sendMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
  const { body } = await requestJson('Telegram sendMessage', `https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(chat), text, link_preview_options: { is_disabled: true } }),
  });
  if (!body?.ok) throw new Error(`Telegram sendMessage failed: ${body?.description}`);
  return body.result;
}
