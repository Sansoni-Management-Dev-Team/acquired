import { connectionCanCompose, gmailConnectionStatus, gmailStatusLabels, gmailStatusMessages } from "@/domain/gmail-connection";
import { WhatsAppConnection } from "@/components/whatsapp-connection";
import { LinkedInConnection } from "@/components/linkedin-connection";
import { ChevronDown, ExternalLink, BriefcaseBusiness, Mail, MessageCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type GmailConnection = {
  address: string | null;
  scopes: string[] | null;
  reconnectRequired: boolean;
  hasRefreshToken: boolean;
  dailyCap: number;
  updatedAt: Date;
};

const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

function ChannelCard({ name, icon: Icon, description, status, connected = false, action, children }: {
  name: string;
  icon: LucideIcon;
  description: string;
  status: string;
  connected?: boolean;
  action: ReactNode;
  children: ReactNode;
}) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="row-span-2 flex size-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)] sm:row-span-1"><Icon size={20} aria-hidden="true" /></div>
      <h3 className="font-semibold">{name}</h3>
      <span className={`col-start-2 w-fit rounded-full border border-[var(--border)] px-2.5 py-1 text-xs sm:col-start-auto ${connected ? "text-[var(--status-emerald)]" : "text-[var(--muted)]"}`}>{status}</span>
    </div>
    <p className="mt-3 text-sm text-[var(--muted)]">{description}</p>
    <div className="mt-4">{action}</div>
    <details className="group mt-4 border-t border-[var(--border)] pt-3">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 rounded text-sm text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
        <span>{name === "Gmail" ? "Connection details" : "Channel details"}<span className="sr-only"> for {name}</span></span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 group-open:rotate-180" />
      </summary>
      <div className="pt-3 text-sm">{children}</div>
    </details>
  </div>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4"><dt className="text-[var(--muted)]">{label}</dt><dd className="break-words text-right">{children}</dd></div>;
}

export function ChannelConnections({ gmail, notice }: { gmail?: GmailConnection; notice: { gmail?: string; reason?: string } }) {
  const linkedinEnabled = Boolean(process.env.LINKEDIN_SERVICE_URL && process.env.LINKEDIN_SERVICE_SECRET);
  const status = gmailConnectionStatus(gmail);
  const gmailConnected = Boolean(gmail && connectionCanCompose(gmail));
  const campaignReady = status === "ready";

  return <section aria-labelledby="channel-connections-heading" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
    <h2 id="channel-connections-heading" className="text-lg font-semibold">Channel connections</h2>
    <p className="mt-2 text-sm text-[var(--muted)]">Connect and manage the channels you use for outreach.</p>
    {notice.gmail === "connected" && <p role="status" className="mt-5 rounded-md border border-emerald-800 bg-[var(--success-surface)] px-4 py-3 text-sm text-[var(--status-emerald)]">Gmail connected successfully.</p>}
    {notice.gmail === "error" && <p role="alert" className="mt-5 rounded-md border border-red-900 bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--status-red)]">Gmail connection failed{notice.reason ? `: ${notice.reason}` : "."}</p>}
    <div className="mt-5 space-y-3">
      <ChannelCard name="Gmail" icon={Mail} description="Send email campaigns and monitor replies from your Gmail account." status={campaignReady ? "Connected" : gmailStatusLabels[status]} connected={campaignReady}
        action={<a href="/api/mailbox/google/connect" className={actionClass}>{gmail ? "Reconnect Gmail" : "Connect Gmail"}</a>}>
        {!campaignReady && <p className="mb-4 text-[var(--status-amber)]">{gmailStatusMessages[status]}</p>}
        <dl className="space-y-3">
          <Detail label="Gmail account">{gmail?.address || (gmail ? "Connected address unavailable" : "—")}</Detail>
          <Detail label="Daily cap">{gmail?.dailyCap ?? 100}</Detail>
          <Detail label="Send permission"><span className={gmailConnected ? "text-[var(--status-emerald)]" : "text-[var(--muted)]"}>{gmailConnected ? "Granted" : "Not granted"}</span></Detail>
          <Detail label="Reply monitoring"><span className={campaignReady ? "text-[var(--status-emerald)]" : "text-[var(--status-amber)]"}>{campaignReady ? "Ready" : gmail ? "Reconnect for read-only access" : "Connect Gmail to enable"}</span></Detail>
          <Detail label="Live sends">After campaign subscription confirmation</Detail>
          {gmail?.updatedAt && <Detail label="Last connected">{gmail.updatedAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" })}</Detail>}
        </dl>
        <p className="mt-4 text-xs text-[var(--muted)]">Gmail requires compose permission to send and read-only permission to check conversations and replies. Your mailbox address is read from Google after consent; refresh tokens remain encrypted at rest.</p>
      </ChannelCard>
      {linkedinEnabled ? <ChannelCard name="LinkedIn" icon={BriefcaseBusiness} description="Connect through an interactive browser and sync conversations." status="Browser connection"
        action={<LinkedInConnection />}>
        <p className="text-[var(--muted)]">Your browser session is encrypted and saved on the connection service. Live sends and campaign delivery are disabled. LinkedIn may request verification or restrict unsupported automation.</p>
        <a href="https://www.linkedin.com/messaging/" target="_blank" rel="noopener noreferrer" className={`${actionClass} mt-3`}>Open LinkedIn<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
      </ChannelCard> : <ChannelCard name="LinkedIn" icon={BriefcaseBusiness} description="Use your outreach drafts to start conversations on LinkedIn." status="Manual outreach"
        action={<a href="https://www.linkedin.com/messaging/" target="_blank" rel="noopener noreferrer" className={actionClass}>Open LinkedIn<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>}>
        <dl className="space-y-3"><Detail label="Delivery">Send manually in LinkedIn</Detail><Detail label="Reply monitoring">Check replies in LinkedIn</Detail></dl>
        <p className="mt-4 text-xs text-[var(--muted)]">Account connections aren’t available yet. Copy your LinkedIn draft from outreach, then review and send it in LinkedIn.</p>
      </ChannelCard>}
      <ChannelCard name="WhatsApp" icon={MessageCircle} description="Link your WhatsApp account by scanning a QR code." status="Linked device"
        action={<WhatsAppConnection />}>
        <p className="text-[var(--muted)]">Your session is encrypted and saved so it can reconnect after a restart. You can disconnect here or unlink Acquire in WhatsApp’s Linked Devices. Campaign delivery remains manual.</p>
      </ChannelCard>
    </div>
  </section>;
}
