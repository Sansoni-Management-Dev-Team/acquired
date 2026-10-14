import {expect,it} from 'vitest';
import {POST} from './route';
it('rejects the unhydrated form without reflecting credentials or redirecting them',async()=>{
 const response=POST();
 expect(response.status).toBe(400);
 expect(response.headers.get('location')).toBeNull();
 expect(response.headers.get('cache-control')).toBe('no-store');
 expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 const body=await response.text();expect(body).toContain('reload');
 expect(body).not.toMatch(/password|email|token|<script/i);
});
