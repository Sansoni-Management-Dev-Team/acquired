import Image from "next/image";
import { SignUpForm } from "@/components/sign-up-form";

export default function SignUpPage() {
  return <div className="grid min-h-screen place-items-center p-6"><div><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain theme-logo" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-2 text-3xl font-semibold">Create your deal desk</h1><p className="mb-6 max-w-md text-sm text-[var(--muted)]">Register your account and organisation. You can connect an email account after signing in.</p><SignUpForm /></div></div>;
}
