import { createStore } from './store.mjs';
import { Sessions } from './sessions.mjs';
import { serviceServer } from './http.mjs';
const store = createStore(process.env);
const sessions = new Sessions(store);
const server = serviceServer(store, sessions, process.env.WHATSAPP_SERVICE_SECRET);
server.listen(8080, '0.0.0.0', () => console.info('WhatsApp service listening on :8080'));
// Schema is checked, never created. Restore previously connected accounts after restart.
try {
  await store.health();
  await sessions.reconcile();
} catch { console.error('WhatsApp schema unavailable; apply the approved migration before connecting'); }
let stopping = false; let reconciling = false;
const recovery = setInterval(async () => {
  if (stopping || reconciling) return;
  reconciling = true;
  try { await store.health(); await sessions.reconcile(); } catch { console.error('WhatsApp recovery deferred; check schema and database availability'); }
  finally { reconciling = false; }
}, store.config.restoreIntervalMs);
recovery.unref();
async function stop() {
  if (stopping) return; stopping = true; clearInterval(recovery);
  server.close();
  try { await sessions.stop(); await store.close(); process.exit(0); } catch { process.exit(1); }
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
