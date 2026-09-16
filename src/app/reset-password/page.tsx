import Image from "next/image";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <div className="grid min-h-screen place-items-center p-6"><div><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain theme-logo" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-2 text-3xl font-semibold">Choose a new password</h1><p className="mb-6 max-w-md text-sm text-[var(--muted)]">Use at least 8 characters. Completing the reset signs out other sessions.</p><ResetPasswordForm token={token} invalid={Boolean(error)} /></div></div>;
}
