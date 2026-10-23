'use client';
import {HttpAgent} from '@ag-ui/client';
/** Durable chat loads authoritative history on the server. Keep the full local
 * transcript visible without resubmitting it on every bounded question. */
export class SavedMandateHttpAgent extends HttpAgent{
 protected requestInit(input:Parameters<HttpAgent['run']>[0]):RequestInit{
  return super.requestInit({...input,messages:input.messages.slice(-1)});
 }
}
