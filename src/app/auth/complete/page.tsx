import Image from "next/image";
import { AuthComplete } from "@/components/auth-complete";

export default function AuthCompletePage() {
  return <div className="grid min-h-screen place-items-center p-6"><div><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-6 text-3xl font-semibold">Preparing your deal desk</h1><AuthComplete /></div></div>;
}
