import Image from "next/image";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return <div className="grid min-h-screen place-items-center p-6"><div><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-2 text-3xl font-semibold">Reset your password</h1><p className="mb-6 max-w-md text-sm text-[var(--muted)]">Enter your email and we’ll send a one-hour reset link.</p><ForgotPasswordForm /></div></div>;
}
