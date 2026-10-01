import { normalizeMessageContent } from '@whiskeysockets/baileys';

export class RecentHistory {
  constructor(limit = 5000, { maxContacts = 5000, maxBytes = 2097152 } = {}) {
    this.limit = limit; this.maxContacts = maxContacts; this.maxBytes = maxBytes;
    this.messages = new Map(); this.contacts = new Map(); this.syncEvents = 0;
    this.messageSizes = new Map(); this.contactSizes = new Map(); this.messageBytes = 0; this.contactBytes = 0;
  }
  size(value) { try { return Buffer.byteLength(JSON.stringify(value)); } catch { return this.maxBytes + 1; } }
  removeMessage(key) { this.messageBytes -= this.messageSizes.get(key) || 0; this.messageSizes.delete(key); this.messages.delete(key); }
  removeContact(key) { this.contactBytes -= this.contactSizes.get(key) || 0; this.contactSizes.delete(key); this.contacts.delete(key); }
  addContacts(contacts) {
    for (const contact of contacts || []) if (contact.id) {
      const merged = { ...this.contacts.get(contact.id), ...Object.fromEntries(Object.entries(contact).filter(([, value]) => value != null)) };
      const bytes = this.size(merged); if (bytes > this.maxBytes / 2) continue;
      this.removeContact(contact.id); this.contacts.set(contact.id, merged); this.contactSizes.set(contact.id, bytes); this.contactBytes += bytes;
      while (this.contacts.size > this.maxContacts || this.contactBytes > this.maxBytes / 2) this.removeContact(this.contacts.keys().next().value);
    }
  }
  addMessages(messages) {
    for (const message of messages || []) {
      if (!message.key?.id || !message.key.remoteJid || !message.message) continue;
      const body = normalizeMessageContent(message.message);
      if (!body || body.protocolMessage || message.key.remoteJid === 'status@broadcast') continue;
      const bytes = this.size(message); if (bytes > this.maxBytes / 2) continue;
      const key = `${message.key.remoteJid}:${message.key.id}:${Boolean(message.key.fromMe)}`;
      this.removeMessage(key); this.messages.set(key, message); this.messageSizes.set(key, bytes); this.messageBytes += bytes;
    }
    if (this.messages.size > this.limit || this.messageBytes > this.maxBytes / 2) {
      const entries = [...this.messages.entries()].sort((a, b) => Number(b[1].messageTimestamp || 0) - Number(a[1].messageTimestamp || 0));
      for (const [key] of entries.reverse()) {
        if (this.messages.size <= this.limit && this.messageBytes <= this.maxBytes / 2) break;
        this.removeMessage(key);
      }
    }
  }
  searchContacts(query) {
    const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
    return [...this.contacts.values()].filter(contact => [contact.name, contact.notify, contact.verifiedName].some(name => typeof name === 'string' && name.toLowerCase().replace(/\s+/g, ' ').includes(normalized)));
  }
  recent(limit = 20, jids) {
    return [...this.messages.values()].filter(message => !jids || jids.includes(message.key.remoteJid))
      .sort((a, b) => Number(b.messageTimestamp || 0) - Number(a.messageTimestamp || 0)).slice(0, limit).map(message => {
        const body = normalizeMessageContent(message.message);
        return { id: message.key.id, chatId: message.key.remoteJid, participant: message.key.participant || null, participantAlt: message.key.participantAlt || null, remoteJidAlt: message.key.remoteJidAlt || null, fromMe: Boolean(message.key.fromMe),
          timestamp: new Date(Number(message.messageTimestamp || 0) * 1000).toISOString(), timestampSeconds: Number(message.messageTimestamp || 0),
          senderName: message.pushName || null,
          text: body.conversation || body.extendedTextMessage?.text || body.imageMessage?.caption || body.videoMessage?.caption || body.documentMessage?.caption || null,
          type: Object.keys(body).find(key => key !== 'messageContextInfo') || 'unknown' };
      });
  }
}
