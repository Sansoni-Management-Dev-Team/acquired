// Live transport smoke test: creates an unpaired, in-memory session only.
// No account is linked, no credentials are persisted and no messages are sent.
import makeWASocket, { initAuthCreds, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
const values = new Map();
const socket = makeWASocket({ logger: pino({ level: 'silent' }), browser: Browsers.ubuntu('Acquire'),
  auth: { creds: initAuthCreds(), keys: { get: async (type, ids) => Object.fromEntries(ids.filter(id => values.has(`${type}:${id}`)).map(id => [id, values.get(`${type}:${id}`)])), set: async data => { for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries)) { if (value == null) values.delete(`${type}:${id}`); else values.set(`${type}:${id}`, value); } } } },
  syncFullHistory: false, markOnlineOnConnect: false });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No pairing QR received within 30 seconds')), 30000);
    socket.ev.on('connection.update', update => {
      if (update.qr) { clearTimeout(timeout); resolve(); }
      else if (update.connection === 'close') { clearTimeout(timeout); reject(new Error('WhatsApp closed the unpaired connection before returning a QR')); }
    });
  });
  console.info('PASS: live WhatsApp Web transport returned a pairing QR (not displayed or persisted).');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { socket.end(new Error('Unpaired transport smoke test complete')); }
