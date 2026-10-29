import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
// Exclusive creation preserves any existing credentials and database volume.
writeFileSync('.env',`RESEARCH_DB_PASSWORD=${randomBytes(32).toString('hex')}\nRESEARCH_SERVICE_SECRET=${randomBytes(32).toString('hex')}\n`,{flag:'wx',mode:0o600});
console.log('Created local-only credentials in ignored .env');
