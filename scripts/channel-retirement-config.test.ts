import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('does not offer retired channel containers in the application Compose configuration',()=>{
 const source=readFileSync(new URL('../compose.local.yml',import.meta.url),'utf8');
 expect(source).not.toMatch(/services\/(?:whatsapp|linkedin)|WHATSAPP_SERVICE_SECRET|LINKEDIN_SERVICE_SECRET/);
});
it('does not advertise retired channel settings in the hosted application template',()=>{
 const source=readFileSync(new URL('../ops/app/hosted.env.example',import.meta.url),'utf8');
 expect(source).not.toMatch(/(?:WHATSAPP|LINKEDIN)_SERVICE_(?:URL|SECRET)|GOOGLE_GMAIL_REDIRECT_URI|TOKEN_ENCRYPTION_KEY|CAMPAIGN_LINKEDIN_ENABLED/);
 expect(source).toContain('GOOGLE_GMAIL_CLIENT_ID='); // Google account sign-in remains supported.
});
it('does not require the retired Gmail encryption key to start the hosted application',()=>{
 const source=readFileSync(new URL('../ops/app/runtime.mjs',import.meta.url),'utf8');
 expect(source).not.toContain('TOKEN_ENCRYPTION_KEY');
});
