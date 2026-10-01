import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { initAuthCreds, proto } from '@whiskeysockets/baileys';
import { authCodec } from './crypto.mjs';
import { serviceConfig, shardFor } from './routing.mjs';

export function createStore(env, options = {}) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const config = serviceConfig(env);
  const codec = authCodec(env.WHATSAPP_ENCRYPTION_KEY);
  const pool = options.pool || new pg.Pool({ connectionString: env.DATABASE_URL, max: config.poolSize,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, idle_in_transaction_session_timeout: 10000,
    ...(env.DATABASE_SSL_CA ? { ssl: { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true } } : {}) });
  const handles = new Set();
  async function authorize(actor) {
    const result = await pool.query('SELECT 1 FROM member WHERE organization_id=$1 AND user_id=$2', [actor.organizationId, actor.userId]);
    if (!result.rowCount) throw Object.assign(new Error('Membership required'), { status: 403 });
  }
  function owns(actor) { return shardFor(actor, config.shardIds) === config.shardId; }
  return {
    config, authorize, owns,
    async health() {
      await pool.query('SELECT id FROM whatsapp_connections LIMIT 0');
      await pool.query('SELECT connection_id FROM whatsapp_auth_keys LIMIT 0');
      await pool.query('SELECT connection_id, owner_token, expires_at FROM whatsapp_session_leases LIMIT 0');
    },
    async list() {
      const result = await pool.query("SELECT organization_id,user_id FROM whatsapp_connections WHERE encrypted_creds IS NOT NULL AND status IN ('connected','reconnecting','connecting') ORDER BY id");
      return result.rows.map(r => ({ organizationId: r.organization_id, userId: r.user_id })).filter(owns);
    },
    async status(actor) {
      await authorize(actor);
      const result = await pool.query('SELECT status,address,updated_at FROM whatsapp_connections WHERE organization_id=$1 AND user_id=$2', [actor.organizationId, actor.userId]);
      return result.rows[0] || { status: 'disconnected', address: null };
    },
    async open(actor) {
      await authorize(actor);
      if (!owns(actor)) throw Object.assign(new Error('Account assigned to another shard'), { status: 421 });
      const token = randomUUID(); let row;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO whatsapp_connections (organization_id,user_id) VALUES ($1,$2)
          ON CONFLICT (organization_id,user_id) DO NOTHING`, [actor.organizationId, actor.userId]);
        const result = await client.query('SELECT id FROM whatsapp_connections WHERE organization_id=$1 AND user_id=$2', [actor.organizationId, actor.userId]);
        row = result.rows[0];
        const claimed = await client.query(`INSERT INTO whatsapp_session_leases (connection_id,owner_token,expires_at) VALUES ($1,$2,clock_timestamp()+$3*interval '1 millisecond')
          ON CONFLICT (connection_id) DO UPDATE SET owner_token=EXCLUDED.owner_token,expires_at=EXCLUDED.expires_at
          WHERE whatsapp_session_leases.expires_at <= clock_timestamp() RETURNING connection_id`, [row.id, token, config.leaseMs]);
        if (!claimed.rowCount) throw Object.assign(new Error('Session already running'), { status: 409 });
        // Read the latest credentials only after acquiring the lease. A previous
        // owner's final fenced write may have committed while claim was waiting.
        const saved = await client.query('SELECT encrypted_creds FROM whatsapp_connections WHERE id=$1', [row.id]);
        row.encrypted_creds = saved.rows[0].encrypted_creds;
        await client.query("UPDATE whatsapp_connections SET status='connecting',updated_at=now() WHERE id=$1", [row.id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      let closed = false; let lost = false; let pending = Promise.resolve(); let renewing = false; let timer;
      const lostHandlers = new Set();
      const leaseLost = () => {
        if (lost || closed) return;
        lost = true; clearInterval(timer);
        for (const fn of lostHandlers) { try { fn(); } catch { /* Session cleanup owns its errors. */ } }
      };
      const assertActive = () => { if (closed || lost) throw Object.assign(new Error('Session lease lost'), { status: 409 }); };
      // Only hold a pooled connection for a short transaction. Row locking fences
      // stale owners: takeover and credential/key writes cannot overlap.
      const run = operation => {
        const next = pending.then(async () => {
          assertActive(); const connection = await pool.connect();
          try {
            await connection.query('BEGIN');
            const lease = await connection.query(`SELECT connection_id FROM whatsapp_session_leases
              WHERE connection_id=$1 AND owner_token=$2 AND expires_at>clock_timestamp() FOR UPDATE`, [row.id, token]);
            if (!lease.rowCount) { leaseLost(); assertActive(); }
            const result = await operation(connection);
            await connection.query('COMMIT'); return result;
          } catch (error) { await connection.query('ROLLBACK'); throw error; }
          finally { connection.release(); }
        });
        pending = next.catch(() => {}); return next;
      };
      const renew = async () => {
        if (closed || lost || renewing) return;
        renewing = true;
        try {
          await run(async connection => {
            await connection.query('UPDATE whatsapp_session_leases SET expires_at=clock_timestamp()+$3*interval \'1 millisecond\' WHERE connection_id=$1 AND owner_token=$2', [row.id, token, config.leaseMs]);
          });
        } catch { leaseLost(); } finally { renewing = false; }
      };
      timer = setInterval(renew, Math.floor(config.leaseMs / 3)); timer.unref();
      let creds;
      try { creds = row.encrypted_creds ? codec.decrypt(row.encrypted_creds) : initAuthCreds(); }
      catch (error) {
        clearInterval(timer); await pool.query('DELETE FROM whatsapp_session_leases WHERE connection_id=$1 AND owner_token=$2', [row.id, token]); throw error;
      }
      const handle = {
        state: { creds, keys: {
          get: (type, ids) => run(async connection => {
            const result = await connection.query('SELECT key_id,encrypted_value FROM whatsapp_auth_keys WHERE connection_id=$1 AND key_type=$2 AND key_id=ANY($3::text[])', [row.id, type, ids]);
            return Object.fromEntries(result.rows.map(r => { const value = codec.decrypt(r.encrypted_value); return [r.key_id, type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value) : value]; }));
          }),
          set: data => run(async connection => {
            for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries)) {
              if (value == null) await connection.query('DELETE FROM whatsapp_auth_keys WHERE connection_id=$1 AND key_type=$2 AND key_id=$3', [row.id, type, id]);
              else await connection.query(`INSERT INTO whatsapp_auth_keys (connection_id,key_type,key_id,encrypted_value) VALUES ($1,$2,$3,$4)
                ON CONFLICT (connection_id,key_type,key_id) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value`, [row.id, type, id, codec.encrypt(value)]);
            }
          }),
        } },
        // Check ownership immediately before external sends as well as DB writes.
        assertLease: () => run(async () => {}),
        onLeaseLost: fn => { lostHandlers.add(fn); if (lost) fn(); },
        renew,
        saveCreds: () => { const encrypted = codec.encrypt(creds); return run(connection => connection.query('UPDATE whatsapp_connections SET encrypted_creds=$2,updated_at=now() WHERE id=$1', [row.id, encrypted])); },
        update: (status, address = null) => run(connection => connection.query('UPDATE whatsapp_connections SET status=$2,address=COALESCE($3,address),updated_at=now() WHERE id=$1', [row.id, status, address])),
        clear: () => run(async connection => {
          await connection.query('DELETE FROM whatsapp_auth_keys WHERE connection_id=$1', [row.id]);
          await connection.query("UPDATE whatsapp_connections SET encrypted_creds=NULL,address=NULL,status='disconnected',updated_at=now() WHERE id=$1", [row.id]);
        }),
        close: async () => {
          if (closed) return;
          closed = true; clearInterval(timer); await pending;
          try { await pool.query('DELETE FROM whatsapp_session_leases WHERE connection_id=$1 AND owner_token=$2', [row.id, token]); }
          finally { handles.delete(handle); }
        },
      };
      handles.add(handle); return handle;
    },
    close: async () => { await Promise.allSettled([...handles].map(handle => handle.close())); await pool.end(); },
  };
}
