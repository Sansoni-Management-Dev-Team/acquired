import { BriefcaseBusiness, Mail, MessageCircle } from "lucide-react";
const channels = [
    { name: "Email", icon: Mail, description: "Connect an email account through Unipile." },
    { name: "WhatsApp", icon: MessageCircle, description: "Connect your WhatsApp account through Unipile." },
    { name: "LinkedIn", icon: BriefcaseBusiness, description: "Connect your LinkedIn account through Unipile." },
];
export function ChannelConnections() {
    return <section aria-labelledby="channel-connections-heading" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
    <h2 id="channel-connections-heading" className="text-lg font-semibold">Channel connections</h2>
    <p id="channel-setup-availability" className="mt-2 text-sm text-[var(--muted)]">Account setup through Unipile is not available yet.</p>
    <div className="mt-5 space-y-3">
      {channels.map(({ name, icon: Icon, description }) => <div key={name} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)]"><Icon size={20} aria-hidden="true"/></div>
          <h3 className="flex-1 font-semibold">{name}</h3>
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">Setup unavailable</span>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">{description}</p>
        <button type="button" disabled aria-describedby="channel-setup-availability" className="mt-4 inline-flex min-h-12 items-center justify-center rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">Connect {name} with Unipile</button>
      </div>)}
    </div>
  </section>;
}
