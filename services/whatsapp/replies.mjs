import { normalizeMessageContent, jidNormalizedUser } from '@whiskeysockets/baileys';

const phoneJid = value => typeof value === 'string' && /^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(jidNormalizedUser(value)) ? jidNormalizedUser(value) : null;
export async function whatsappReplyEvent(message, resolvePhone = async () => null) {
  const key = message.key;
  if (!key?.id || key.fromMe || !/^[\d:]+@(s\.whatsapp\.net|lid)$/.test(key.remoteJid || '') || !message.message) return null;
  const body = normalizeMessageContent(message.message);
  const supported = ['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'contactsArrayMessage', 'locationMessage', 'liveLocationMessage', 'pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3'];
  if (!body || body.protocolMessage || body.reactionMessage || !supported.some(type => type in body)) return null;
  const remoteIdentity = jidNormalizedUser(key.remoteJid);
  const mapped = remoteIdentity.endsWith('@lid') ? phoneJid(await resolvePhone(remoteIdentity)) : phoneJid(remoteIdentity);
  const alternate = phoneJid(key.remoteJidAlt);
  if (mapped && alternate && mapped !== alternate) throw new Error('Conflicting WhatsApp sender aliases');
  const seconds = Number(message.messageTimestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid WhatsApp reply timestamp');
  return { id: `${remoteIdentity}:${key.id}`, remoteIdentity, fromIdentity: mapped || alternate, receivedAt: new Date(seconds * 1000).toISOString() };
}

export function replyCursor(account, after) {
  return Buffer.from(JSON.stringify({ account, after })).toString('base64url');
}
export function parseReplyCursor(cursor, account) {
  if (!cursor) return '0';
  if (cursor.length > 4000) throw new Error('Invalid reply checkpoint');
  const data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (data.account !== account) throw new Error('Reply monitor account changed');
  if (typeof data.after !== 'string' || !/^\d{1,20}$/.test(data.after)) throw new Error('Invalid reply checkpoint');
  return data.after;
}
