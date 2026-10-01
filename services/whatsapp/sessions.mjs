import makeWASocket, { DisconnectReason, Browsers, proto } from '@whiskeysockets/baileys';
import { randomUUID } from 'node:crypto';
import { RecentHistory } from './history.mjs';
import { serviceConfig } from './routing.mjs';
import QRCode from 'qrcode';
import pino from 'pino';

export class Sessions {
  constructor(store, socketFactory = makeWASocket, config = store.config || serviceConfig()) {
    this.store = store; this.socketFactory = socketFactory; this.config = config;
    this.sessions = new Map(); this.operations = new Map(); this.stopping = false; this.nextConnectAt = 0; this.startWaits = new Set();
  }
  async paceConnect() {
    const now = Date.now(); const scheduled = Math.max(now, this.nextConnectAt);
    this.nextConnectAt = scheduled + this.config.connectSpacingMs;
    if (scheduled > now) await new Promise(resolve => {
      const finish = () => { this.startWaits.delete(cancel); resolve(); };
      const timer = setTimeout(finish, scheduled - now);
      const cancel = () => { clearTimeout(timer); finish(); };
      this.startWaits.add(cancel);
    });
  }
  async reconcile() {
    if (this.stopping) return;
    for (const actor of await this.store.list()) {
      if (this.stopping || this.sessions.size >= this.config.maxSessions) break;
      if (this.sessions.has(this.key(actor))) continue;
      try { await this.connect(actor); } catch { /* Busy leases and transient errors retry on the next pass. */ }
    }
  }
  metrics() {
    return { sessions: this.sessions.size, maxSessions: this.config.maxSessions, shard: this.config.shardId,
      rssMb: Math.ceil(process.memoryUsage().rss / 1048576), maxRssMb: this.config.maxRssMb };
  }
  key(actor) { return JSON.stringify([actor.organizationId, actor.userId]); }
  drop(session) {
    const key = this.key(session.actor);
    if (this.sessions.get(key) === session) this.sessions.delete(key);
  }
  async status(actor) {
    const saved = await this.store.status(actor);
    const session = this.sessions.get(this.key(actor));
    return { ...saved, qr: session?.qr || null, ...(session?.status ? { status: session.status } : {}) };
  }
  mutate(actor, operation) {
    const key = this.key(actor);
    const pending = (this.operations.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(key, pending);
    void pending.finally(() => { if (this.operations.get(key) === pending) this.operations.delete(key); }).catch(() => {});
    return pending;
  }
  connect(actor) { return this.mutate(actor, () => this.connectUnlocked(actor)); }
  disconnect(actor) { return this.mutate(actor, () => this.disconnectUnlocked(actor)); }
  async connectUnlocked(actor) {
    await this.store.authorize(actor);
    const key = this.key(actor);
    if (this.sessions.has(key)) return this.status(actor);
    if (this.stopping || this.sessions.size >= this.config.maxSessions || process.memoryUsage().rss > this.config.maxRssMb * 1048576) throw Object.assign(new Error('Session capacity reached'), { status: 503 });
    const session = { history: new RecentHistory(this.config.historyMessages, { maxContacts: this.config.historyContacts, maxBytes: this.config.historyBytes }), actor, qr: null, status: 'connecting', stopped: false, attempt: 0, events: Promise.resolve() };
    this.sessions.set(key, session);
    try {
      await this.paceConnect();
      if (this.stopping) throw new Error('Service shutting down');
      session.auth = await this.store.open(actor);
      session.auth.onLeaseLost?.(() => {
        session.stopped = true; session.qr = null; clearTimeout(session.timer);
        session.socket?.end(new Error('Session lease lost'));
        this.drop(session);
        void session.auth.close().catch(() => {});
      });
      await session.auth.saveCreds(); this.start(session);
    }
    catch (error) { this.drop(session); if (session.auth) await session.auth.close(); throw error; }
    return this.status(actor);
  }
  start(session) {
    if (session.stopped || this.stopping) return;
    const socket = this.socketFactory({ auth: session.auth.state, logger: pino({ level: 'silent' }), browser: Browsers.ubuntu('Acquire'), syncFullHistory: false,
      shouldSyncHistoryMessage: () => true, markOnlineOnConnect: false, getMessage: async () => undefined });
    session.socket = socket;
    const enqueue = fn => {
      session.events = session.events.then(async () => { if (!session.stopped && session.socket === socket) await fn(); }).catch(async () => {
        // Never log credentials, QR codes, message bodies or raw provider errors.
        session.status = 'error'; session.qr = null; session.stopped = true;
        clearTimeout(session.timer); socket.end(new Error('Session persistence failed'));
        await session.auth.update('reconnecting').catch(() => {});
        await session.auth.close().catch(() => {});
        this.drop(session);
      });
    };
    socket.ev.on('messaging-history.set', data => enqueue(async () => {
      session.history.addContacts(data.contacts); session.history.addMessages(data.messages); session.history.syncEvents++;
    }));
    socket.ev.on('messages.upsert', data => enqueue(async () => session.history.addMessages(data.messages)));
    socket.ev.on('contacts.upsert', contacts => enqueue(async () => session.history.addContacts(contacts)));
    socket.ev.on('contacts.update', contacts => enqueue(async () => session.history.addContacts(contacts)));
    socket.ev.on('creds.update', () => enqueue(() => session.auth.saveCreds()));
    socket.ev.on('connection.update', update => enqueue(async () => {
      if (update.qr) { session.qr = await QRCode.toDataURL(update.qr); session.status = 'qr'; await session.auth.update('qr'); }
      if (update.connection === 'open') {
        session.qr = null; session.status = 'connected'; session.attempt = 0;
        await session.auth.update('connected', socket.user?.id?.split(':')[0]?.split('@')[0] || null);
      }
      if (update.connection === 'close') {
        session.qr = null;
        const reason = update.lastDisconnect?.error?.output?.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          session.stopped = true; session.status = 'reconnect_required';
          await session.auth.clear(); await session.auth.update('reconnect_required'); await session.auth.close();
          this.drop(session);
        } else {
          session.status = 'reconnecting'; await session.auth.update('reconnecting');
          const delay = reason === DisconnectReason.restartRequired ? 100 : Math.min(30000, 1000 * 2 ** Math.min(session.attempt++, 5)) + Math.floor(Math.random() * 1000);
          session.timer = setTimeout(() => {
            void this.paceConnect().then(() => this.start(session));
          }, delay);
        }
      }
    }));
  }
  async readHistory(actor, query, limit = 20, chatId) {
    await this.store.authorize(actor);
    const session = this.sessions.get(this.key(actor));
    if (!session || session.stopped || session.status !== 'connected') throw Object.assign(new Error('Not connected'), { status: 409 });
    const matches = query ? session.history.searchContacts(query) : [];
    const jids = chatId ? [chatId] : query ? [...new Set(matches.flatMap(contact => [contact.id, contact.lid, contact.phoneNumber].filter(Boolean)))] : undefined;
    return { contacts: matches, messages: session.history.recent(limit, jids), cachedMessages: session.history.messages.size, cachedContacts: session.history.contacts.size, syncEvents: session.history.syncEvents };
  }
  async requestHistory(actor, chatId) {
    await this.store.authorize(actor);
    const session = this.sessions.get(this.key(actor));
    if (!session || session.stopped || session.status !== 'connected') throw Object.assign(new Error('Not connected'), { status: 409 });
    if (chatId) {
      const oldest = session.history.recent(5000, [chatId]).at(-1);
      if (!oldest) throw Object.assign(new Error('No history anchor'), { status: 409 });
      await session.socket.fetchMessageHistory(100, { remoteJid: chatId, id: oldest.id, fromMe: oldest.fromMe }, oldest.timestampSeconds * 1000);
    } else {
      await session.socket.sendPeerDataOperationMessage({ peerDataOperationRequestType: proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,
        fullHistorySyncOnDemandRequest: { requestMetadata: { requestId: randomUUID() }, historySyncConfig: { fullSyncDaysLimit: 30, fullSyncSizeMbLimit: 20, storageQuotaMb: 20, recentSyncDaysLimit: 7 } } });
    }
    return { requested: true };
  }
  async readGroup(actor, groupId) {
    await this.store.authorize(actor);
    const session = this.sessions.get(this.key(actor));
    if (!session || session.stopped || session.status !== 'connected') throw Object.assign(new Error('Not connected'), { status: 409 });
    const metadata = await session.socket.groupMetadata(groupId);
    const participants = await Promise.all(metadata.participants.map(async participant => {
      const lid = participant.lid || (participant.id.endsWith('@lid') ? participant.id : undefined);
      const phoneNumber = participant.phoneNumber || (participant.id.endsWith('@s.whatsapp.net') ? participant.id : undefined)
        || (lid ? await session.socket.signalRepository.lidMapping.getPNForLID(lid) : undefined);
      const aliases = [participant.id, lid, phoneNumber].filter(Boolean);
      const contact = [...session.history.contacts.values()].find(item => [item.id, item.lid, item.phoneNumber].some(id => aliases.includes(id)));
      return { id: participant.id, lid: lid || null, phoneNumber: phoneNumber || null, name: contact?.name || contact?.notify || null, admin: participant.admin || null };
    }));
    return { id: metadata.id, subject: metadata.subject, participants };
  }
  async sendText(actor, recipient, text) {
    await this.store.authorize(actor);
    const session = this.sessions.get(this.key(actor));
    if (!session || session.stopped || session.status !== 'connected') throw Object.assign(new Error('Not connected'), { status: 409 });
    await session.auth.assertLease?.();
    const sent = await session.socket.sendMessage(recipient, { text });
    return { id: sent.key.id, recipient: sent.key.remoteJid, status: 'submitted' };
  }
  async disconnectUnlocked(actor) {
    await this.store.authorize(actor);
    const key = this.key(actor);
    const session = this.sessions.get(key);
    if (!session) {
      const auth = await this.store.open(actor);
      try { await auth.clear(); } finally { await auth.close(); }
      return;
    }
    session.stopped = true; clearTimeout(session.timer); session.qr = null;
    await session.events;
    try { await session.auth.assertLease?.(); if (session.socket?.user) await session.socket.logout(); }
    catch { /* Local deletion still revokes our access; user can unlink on their phone. */ }
    finally {
      session.socket?.end(new Error('Disconnected by owner'));
      try { await session.auth.clear(); } finally { await session.auth.close(); this.drop(session); }
    }
  }
  async stop() {
    this.stopping = true;
    for (const cancel of this.startWaits) cancel();
    await Promise.allSettled([...this.operations.values()]);
    await Promise.allSettled([...this.sessions.values()].map(async session => {
      session.stopped = true; clearTimeout(session.timer); session.socket?.end(new Error('Service shutdown'));
      await session.events;
      try { await session.auth.saveCreds(); } finally { await session.auth.close(); }
    }));
    this.sessions.clear();
  }
}
