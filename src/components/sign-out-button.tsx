"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return <button type="button" onClick={signOut} className="mt-4 flex min-h-12 items-center gap-3 rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--panel-raised)]"><LogOut size={18} aria-hidden="true" />Sign out</button>;
}
