import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BufferJSON } from '@whiskeysockets/baileys';

export function authCodec(encodedKey) {
  const key = Buffer.from(encodedKey || '', 'base64');
  if (key.length !== 32) throw new Error('WHATSAPP_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return {
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value, BufferJSON.replacer)), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
    },
    decrypt(value) {
      const [version, iv, tag, ciphertext] = value.split('.');
      if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid auth ciphertext');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(), BufferJSON.reviver);
    },
  };
}
