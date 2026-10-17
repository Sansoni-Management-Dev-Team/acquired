import { types } from 'node:util';
import { AccountRuntimeVault } from '../../storage-postgres/src/account-vault';
import type { SqlPool } from '../../storage-postgres/src/webhook-repository';
import type { ConfiguredUnipileV1RuntimeOptions } from './v1-runtime';
/** Explicit server-only input: never reads process.env, dotenv, files, network or a database. */
export function readConfiguredUnipileV1Environment(env: Readonly<Record<string, string | undefined>>, pool: SqlPool): {
    options: ConfiguredUnipileV1RuntimeOptions;
    scopedAuthKey: Uint8Array;
} {
    try {
        if (!env || types.isProxy(env) || ![Object.prototype, null].includes(Object.getPrototypeOf(env)))
            throw Error();
        const d = Object.getOwnPropertyDescriptors(env);
        if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !('value' in d[k])))
            throw Error();
        const get = (name: string) => { const v = d[name]?.value; if (types.isPromise(v)) {
            void Promise.prototype.then.call(v, undefined, () => { });
            throw Error();
        } if (typeof v !== 'string' || v.length < 1 || v.length > 131072 || v !== v.trim())
            throw Error(); return v; };
        const bytes = (v: string) => { if (!/^[A-Za-z0-9+/]{43}=$/.test(v))
            throw Error(); const result = Buffer.from(v, 'base64'); if (result.length !== 32 || result.toString('base64') !== v)
            throw Error(); return result; };
        const rows = JSON.parse(get('COMMUNICATIONS_KEYRING_JSON'));
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > 32)
            throw Error();
        const keys = rows.map(row => { if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'digestKey,encryptionKey,version' || typeof row.version !== 'string')
            throw Error(); return { version: row.version, encryptionKey: bytes(row.encryptionKey), digestKey: bytes(row.digestKey) }; });
        const identityKey = bytes(get('COMMUNICATIONS_IDENTITY_KEY')), callbackKey = bytes(get('COMMUNICATIONS_SETUP_CALLBACK_KEY')), scopedAuthKey = bytes(get('COMMUNICATIONS_SCOPED_AUTH_KEY'));
        const all = [identityKey, callbackKey, scopedAuthKey, ...keys.flatMap(k => [k.encryptionKey, k.digestKey])];
        if (new Set(all.map(k => k.toString('hex'))).size !== all.length)
            throw Error();
        const vault = { activeVersion: get('COMMUNICATIONS_ACTIVE_KEY_VERSION'), keys, identityKey, identityKeyVersion: get('COMMUNICATIONS_IDENTITY_KEY_VERSION') };
        new AccountRuntimeVault(vault);
        const api = new URL(get('UNIPILE_API_URL'));
        if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || !['/', '/api/v1', '/api/v1/'].includes(api.pathname))
            throw Error();
        const origin = get('COMMUNICATIONS_REDIRECT_ORIGIN'), notify = get('COMMUNICATIONS_SETUP_NOTIFY_URL');
        const ru = new URL(origin), nu = new URL(notify);
        if (ru.protocol !== 'https:' || ru.origin !== origin || nu.protocol !== 'https:' || nu.username || nu.password || nu.search || nu.hash)
            throw Error();
        let localSimulatorOrigin:string|undefined;
        if(d.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==undefined){
            localSimulatorOrigin=get('COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN');
            if(d.NODE_ENV?.value!=='development'||d.AGENT_MODE_COMMUNICATIONS_MODE?.value!=='simulator'||!['https://127.0.0.1:5490','https://127.0.0.1:5590','https://127.0.0.1:5690','https://127.0.0.1:5790'].includes(localSimulatorOrigin)||api.origin!==localSimulatorOrigin||ru.origin!==(localSimulatorOrigin==='https://127.0.0.1:5790'?'https://127.0.0.1:5791':localSimulatorOrigin==='https://127.0.0.1:5690'?'https://127.0.0.1:5691':localSimulatorOrigin==='https://127.0.0.1:5590'?'https://127.0.0.1:5591':'https://127.0.0.1:5491')||nu.href!==ru.origin+'/v1/setup/notify'||!get('COMMUNICATIONS_INTEGRATION_ID').startsWith('sim-')||!get('COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE').startsWith('sim-'))throw Error();
            for(const key of ['DATABASE_URL','COMMUNICATIONS_DATABASE_URL']){
                const database=new URL(get(key));
                const exactTarget=database.hostname==='postgres'&&database.port==='5432'||database.hostname==='127.0.0.1'&&database.port==='5437';
                if(!['postgres:','postgresql:'].includes(database.protocol)||!exactTarget||database.pathname!=='/acquire_agent_mode'||database.search||database.hash)throw Error();
            }
        }
        const sourceIds: ConfiguredUnipileV1RuntimeOptions['sourceIds'] = {};
        for (const platform of ['gmail', 'outlook', 'linkedin', 'whatsapp'] as const) {
            const value = d[`COMMUNICATIONS_${platform.toUpperCase()}_SOURCE_ID`]?.value;
            if (value !== undefined) {
                if (typeof value !== 'string' || !value.trim() || value.length > 2000)
                    throw Error();
                sourceIds[platform] = value;
            }
        }
        const options: ConfiguredUnipileV1RuntimeOptions = { pool, provider: { apiVersion: 'v1', baseUrl: `${api.origin}/api/v1`, apiKey: get('UNIPILE_API_KEY'), timeoutMs: 5000 }, applicationId: get('COMMUNICATIONS_APPLICATION_ID'), integrationId: get('COMMUNICATIONS_INTEGRATION_ID'), providerConfigurationReference: get('COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE'), vault, callbackKey, webhookSecret: get('COMMUNICATIONS_WEBHOOK_SECRET'), redirectOrigin: origin, successPath: d.COMMUNICATIONS_SETUP_SUCCESS_PATH?.value ?? '/settings?setup=returned', failurePath: d.COMMUNICATIONS_SETUP_FAILURE_PATH?.value ?? '/settings?setup=failed', notifyUrl: notify, sourceIds };
        if(localSimulatorOrigin)options.localSimulatorOrigin=localSimulatorOrigin;
        return { options, scopedAuthKey };
    }
    catch {
        throw Error('Invalid communications environment');
    }
}
