import Image from "next/image";
import { SignInForm } from "@/components/sign-in-form";
import { safeRedirectPath } from "@/lib/safe-redirect-path";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <div className="grid min-h-screen place-items-center p-6"><div><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-6 text-3xl font-semibold">Sign in to the deal desk</h1><SignInForm redirectTo={safeRedirectPath(next)} /></div></div>;
}
