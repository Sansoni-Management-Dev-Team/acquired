import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {SignInForm} from './sign-in-form';
import {SignUpForm} from './sign-up-form';
import {ForgotPasswordForm} from './forgot-password-form';
import {ResetPasswordForm} from './reset-password-form';
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn()})}));
vi.mock('@/lib/auth-client',()=>({authClient:{}}));
it.each([
 ['sign in',()=> <SignInForm/>],
 ['sign up',()=> <SignUpForm/>],
 ['forgot password',()=> <ForgotPasswordForm/>],
 ['reset password',()=> <ResetPasswordForm token="synthetic-reset-token"/>],
])('%s never falls back to placing credentials in a GET URL',(_name,view)=>{
 const html=renderToStaticMarkup(view()),form=html.match(/<form\b[^>]*>/)?.[0];
 expect(form).toContain('method="post"');
 expect(form).toContain('action="/api/auth/form-unavailable"');
});
