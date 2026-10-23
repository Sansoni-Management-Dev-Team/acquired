"use client";
import {loadAgentControls} from '@/lib/agent-controls-load';
import {readJsonResponse} from '@/lib/read-json-response';
import { AgentWelcome } from "./agent-welcome";
import {AgentChatSurface,AgentChatStatus} from "./agent-chat-ui";
import type {AgentReviewBatchView} from "./agent-review-cards";
import actionStyles from "./agent-chat-actions.module.css";
import settingsStyles from "./agent-settings.module.css";
import { AgentDemoApprovalControls } from "./agent-demo-approval-controls";
import { useAgentDemoApprovalPreference } from "./use-agent-demo-approval-preference";
import {
  AGENT_DEMO_AUTO_APPROVAL_OFF,
  eligibleSimulatedAutoApprovalBatches,
  type AgentDemoAutoApprovalSelection,
} from "./agent-demo-auto-approval";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { randomUuid } from "@/lib/random-uuid";
import {
  agentReadinessReason,
  type AgentRuntimeReadiness,
  type agentRuntimeConfiguration,
} from "@/lib/agent-runtime-readiness";
import { startAgentActivityPolling } from "@/lib/agent-activity-poller";
import type {
  AgentHandoffAction,
  AgentHandoffInbox,
} from "@/domain/agent-handoffs";
import {
  AgentChannelGrantControls,
  type AgentChannelGrantRoute,
} from "./agent-channel-grant-controls";
import { AgentChannelBudgetControls } from "./agent-channel-budget-controls";
import {
  AgentOutreachProgress,
  type AgentOutreachConversation,
} from "./agent-outreach-progress";
import { agentContactReviewBatchSize } from "@/domain/agent-mode";
import {
  AgentChannelPolicyControls,
  type AgentChannelPolicyView,
} from "./agent-channel-policy-controls";
import { AgentSequenceControls } from "./agent-sequence-controls";
import { AgentSequenceHandoverControls } from "./agent-sequence-handover-controls";
import { AgentResearchControls } from "./agent-research-controls";
import { AgentBudgetControls } from "./agent-budget-controls";
import { AgentHandoffTasks } from "./agent-handoff-tasks";
type Conversation = AgentOutreachConversation;
type Grant = {
  id: string;
  revision: number;
  actions: string[];
  recipient_keys: string[];
  max_sends: number;
  used_sends: number;
  expires_at: string;
  revoked_at?: string | null;
};
export type AgentControlsData = {
  enabled: boolean;
  demoPreparationEnabled?: boolean;
  demoService?: { communicationsApi: string; ready: boolean; message?: string };
  channelPolicy?: AgentChannelPolicyView & { enabled?: boolean };
  channelPolicyUnavailable?: boolean;
  readinessUnavailable?: boolean;
  readiness?: AgentRuntimeReadiness;
  configuration?: ReturnType<typeof agentRuntimeConfiguration>;
  simulationEnabled?: boolean;
  targetOptions?: {
    simulationEnabled: boolean;
    bindings: { id: string; label: string }[];
  };
  mandateRevision?: string;
  state: null | {
    contactSelectionEmpty?: boolean;
    contactAllocation?: {
      state: "queued" | "running" | "needs_review";
      allocated: number;
      needsReview: number;
    };
    demoContacts?: { prepared: number; stale: number; outreachReady: boolean };
    executionMode?: "real" | "demo";
    mandateRevision: string;
    responsibility: null | {
      id: string;
      state: string;
      revision: number;
      owner_user_id: string;
      mandate_revision?: string;
    };
    conversations: Conversation[];
  };
  inbox: AgentHandoffInbox;
  grants: Grant[];
};
export type AgentConversationOptions = {
  allowTestAutoApproval: boolean;
  automation: AgentDemoAutoApprovalSelection;
  onAutomationStopped: () => void;
};
type Props = {
  mandateId: string;
  mandateDescription?: string;
  savedData?: { companies?: number; people?: number };
  focusedConversationId?: string | null;
  conversationFocusRequest?: number;
  pendingContactReview?: boolean;
  pendingReviews?: AgentReviewBatchView[];
  pendingMessageReviews?: number;
  onShowReviews?: () => void;
  onConversationActionStart?: () => void;
  onActionSaved?: () => Promise<void>;
  onViewCompanies?: () => void;
  onViewPeople?: () => void;
  initialResearchStatus?: string;
  initialResearchSource?: "cached" | "live";
  busy?: boolean;
  initial?: AgentControlsData;
  onFeedback?: (input: unknown) => Promise<boolean>;
  onBusyChange?: (busy: boolean) => void;
  children: (
    setup: React.ReactNode,
    options?: AgentConversationOptions,
  ) => React.ReactNode;
};
const button =
  "min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40";
const field =
  "mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
export function AgentControlsPanel({
  mandateId,
  mandateDescription,
  savedData,
  focusedConversationId,
  conversationFocusRequest,
  busy = false,
  initial,
  initialResearchStatus,
  initialResearchSource,
  pendingContactReview = false,
  pendingReviews,
  pendingMessageReviews = 0,
  onShowReviews,
  onConversationActionStart,
  onActionSaved,
  onViewCompanies,
  onViewPeople,
  onBusyChange,
  onFeedback,
  children: renderConversation,
}: Props) {
  const setupAnchor = useRef<HTMLElement>(null),
    fundingAnchor = useRef<HTMLDivElement>(null),
    advanced = useRef<HTMLDetailsElement>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    settingsId = useId(),
    settingsTitleId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false),
    [fundingWaiting, setFundingWaiting] = useState(false);
  function openSettings() {
    if (!dialog.current) return;
    if (!dialog.current.open) dialog.current.showModal();
    setSettingsOpen(true);
  }
  function closeSettings() {
    dialog.current?.close();
    setSettingsOpen(false);
  }
  const [data, setData] = useState<AgentControlsData | undefined>(initial),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [pollUnavailable, setPollUnavailable] = useState(false);
  const lock = useRef(false),
    externalBusy = useRef(busy),
    generation = useRef(0),
    mounted = useRef(true),
    retryKeys = useRef(new Map<string, string>());
  const [selected, setSelected] = useState<Record<string, string>>({}),
    [actions, setActions] = useState<string[]>(["reply_email"]),
    [cap, setCap] = useState(1),
    [expiry, setExpiry] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [targetDelivery, setTargetDelivery] = useState("");
  useEffect(() => {
    externalBusy.current = busy;
  }, [busy]);
  const endpoint = (kind: string) => `/api/mandates/${mandateId}/agent/${kind}`;
  const load=useCallback(async (signal: AbortSignal): Promise<AgentControlsData> => {
    const read = async (kind: string) => {
      signal.throwIfAborted();
      const response = await fetch(`/api/mandates/${mandateId}/agent/${kind}`, {
        cache: "no-store",
        headers:kind==='execution'?{'X-Acquire-Control-Snapshot':'1'}:undefined,
        signal: AbortSignal.any([signal, AbortSignal.timeout(kind==='execution'?30000:15000)]),
      });
      if (!response.ok) throw new Error("Agent controls could not be loaded.");
      return readJsonResponse(response,'Current agent status is temporarily unavailable. Please try again.');
    };
    return loadAgentControls(read);
  },[mandateId]);
  useEffect(() => {
    mounted.current = true;
    const stop = startAgentActivityPolling({
      isBusy: () => lock.current || externalBusy.current,
      isVisible: () => document.visibilityState !== "hidden",
      version: () => generation.current,
      load,
      apply: (value) => {
        setData(value);
        setPollUnavailable(false);
      },
      onFailure: (count) => {
        if (count >= 3) setPollUnavailable(true);
      },
    });
    return () => {
      mounted.current = false;
      stop();
    };
  }, [mandateId,load]);
  async function mutate(kind: string, value: unknown) {
    if (
      lock.current ||
      externalBusy.current ||
      !data ||
      (!["channel-policy", "channel-budgets"].includes(kind) && !data.enabled)
    )
      throw new Error("Agent controls are unavailable.");
    const payload = value as Record<string, unknown>,
      { requestKey: requestedKey, ...command } = payload,
      identity = kind + ":" + JSON.stringify(command);
    const requestKey = retryKeys.current.get(identity) ?? String(requestedKey);
    retryKeys.current.set(identity, requestKey);
    onConversationActionStart?.();
    generation.current++;
    lock.current = true;
    setWorking(true);
    onBusyChange?.(true);
    setError("");
    try {
      const response = await fetch(endpoint(kind), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...command, requestKey }),
          signal: AbortSignal.timeout(kind === "demo" && command.action === "start" ? 150000 : 15000),
        }),
        result = await readJsonResponse(response, 'Could not confirm this action. Check saved progress before trying again.');
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "This item changed. Refresh before retrying.",
        );
      retryKeys.current.delete(identity);
      try {
        const current = await load(AbortSignal.timeout(60000));
        if (mounted.current) {
          setData(current);
          setPollUnavailable(false);
        }
      } catch {
        if (mounted.current) {
          setPollUnavailable(true);
          setError("Action saved. Current status could not be refreshed yet.");
        }
      }
      try {
        await onActionSaved?.();
      } catch {
        if (mounted.current) {
          setPollUnavailable(true);
          setError("Action saved. Refresh chat to see the latest review.");
        }
      }
      return result;
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)
            ? kind === "demo" && command.action === "start"
              ? "Preparation is still unconfirmed. Press Start again to check the same saved request."
              : "Could not confirm this action. Check saved progress before trying again."
            : cause instanceof Error
            ? cause.message
            : "Could not save this action. Check saved state before retrying.",
        );
      throw cause;
    } finally {
      lock.current = false;
      if (mounted.current) {
        setWorking(false);
        onBusyChange?.(false);
      }
    }
  }
  const disabled = busy || working || !data?.enabled,
    responsibility = data?.state?.responsibility,
    conversations = data?.state?.conversations ?? [],
    mandateRevision = data?.state?.mandateRevision ?? data?.mandateRevision;
  const policy = data?.channelPolicy?.policy,
    readinessChannels = data?.readiness?.channels ?? [];
  // Saved policy selects the required accounts; other available channels are optional.
  const requiredChannels = policy
    ? policy.channelOrder.map((channel) => {
        const binding = policy.bindings.find(
          (binding) => binding.channel === channel,
        );
        return (
          readinessChannels.find(
            (value) =>
              value.channel === channel &&
              value.bindingId === binding?.bindingId &&
              value.generationDigest === binding?.bindingDigest,
          ) ?? {
            channel,
            ready: false,
            reason: "recorded_account_changed",
            readiness: "verification_required" as const,
          }
        );
      })
    : readinessChannels;
  const readinessRows = [
    ...requiredChannels.map((channel) => ({ ...channel, selected: true })),
    ...(policy
      ? readinessChannels
          .filter(
            (channel) =>
              !policy.channelOrder.some(
                (selected) => selected === channel.channel,
              ),
          )
          .map((channel) => ({ ...channel, selected: false }))
      : []),
  ];
  const testingBlocked = Boolean(data?.demoService && !data.demoService.ready);
  const setupNeeded =
    testingBlocked ||
    (data?.configuration?.scopeMode === "registered" &&
      (!data.readiness?.registered ||
        data.configuration.modelConfigured === false ||
        requiredChannels.some((channel) => !channel.ready)));
  const running =
      responsibility && ["ready", "waiting"].includes(responsibility.state),
    paused = responsibility?.state === "paused";
  const allowTestAutoApproval = Boolean(
    data?.enabled &&
      running &&
      data.state?.executionMode === "demo" &&
      data.state.demoContacts?.outreachReady &&
      data.configuration?.simulation &&
      data.configuration.scopeMode === "registered" &&
      data.readiness?.registered &&
      !setupNeeded &&
      !data.channelPolicyUnavailable &&
      !data.readinessUnavailable &&
      !pollUnavailable,
  );
  const {
    selection: automation,
    setSelection: setAutomation,
    persistent: automationPersistent,
  } = useAgentDemoApprovalPreference(
    mandateId,
    responsibility?.owner_user_id,
    allowTestAutoApproval,
  );
  const automaticPending=allowTestAutoApproval?eligibleSimulatedAutoApprovalBatches(pendingReviews??[],automation):[];
  const automaticIds=new Set(automaticPending.map(batch=>batch.id));
  const manualPending=pendingReviews?pendingReviews.filter(batch=>batch.state==='pending'&&!automaticIds.has(batch.id)).length:pendingMessageReviews;
  const autoContacts=allowTestAutoApproval&&automation.contacts;
  function stopAutomation() {
    setAutomation(AGENT_DEMO_AUTO_APPROVAL_OFF);
  }
  const autoContactsAttempted = useRef(new Set<string>()),
    autoContactsInFlight = useRef(false);
  useEffect(() => {
    if (
      !allowTestAutoApproval ||
      !automation.contacts ||
      disabled ||
      !policy ||
      pendingContactReview ||
      pendingMessageReviews > 0 ||
      data?.state?.contactSelectionEmpty ||
      !data?.state
    )
      return;
    const allocation = data.state.contactAllocation;
    if (
      allocation &&
      ["queued", "running", "needs_review"].includes(allocation.state)
    )
      return;
    const prepared = data.state.demoContacts?.prepared ?? 0;
    if (prepared <= conversations.length) return;
    const key = [
      mandateId,
      mandateRevision,
      policy.revision,
      prepared,
      conversations.length,
    ].join(":");
    if (autoContactsInFlight.current || autoContactsAttempted.current.has(key))
      return;
    autoContactsAttempted.current.add(key);
    autoContactsInFlight.current = true;
    void mutate("targets", {
      requestKey: randomUuid(),
      delivery: { mode: "channels", policyRevision: policy.revision },
    })
      .catch(() => {
        if (mounted.current) stopAutomation();
      })
      .finally(() => {
        autoContactsInFlight.current = false;
      });
  });
  const initialResearchActive = Boolean(
    running &&
      ["queued", "discovering", "crawling", "extracting"].includes(
        initialResearchStatus ?? "",
      ),
  );
  const initialResearchNeedsAttention = Boolean(
      running && ["partial", "failed"].includes(initialResearchStatus ?? ""),
    ),
    cachedDemoReady = Boolean(
      running &&
        initialResearchSource === "cached" &&
        initialResearchStatus === "complete",
    );
  const briefChanged = Boolean(
    running &&
      responsibility?.mandate_revision &&
      mandateRevision &&
      responsibility.mandate_revision !== mandateRevision,
  );
  async function control(action: "start" | "pause" | "resume") {
    if (!mandateRevision) return;
    try {
      await mutate("execution", {
        action,
        requestKey: randomUuid(),
        expectedRevision: responsibility?.revision ?? 0,
        mandateRevision,
      });
    } catch {
      /* Visible error retains current state. */
    }
  }
  async function handover(
    conversation: Conversation,
    target?: "human" | "agent",
  ) {
    if (!responsibility) return;
    const expected = {
      conversationId: conversation.id,
      revision: conversation.revision,
      epoch: Number(conversation.epoch),
      contextRevision: conversation.context_revision,
    };
    try {
      await mutate(
        "execution",
        target
          ? {
              action: "handover_begin",
              requestKey: randomUuid(),
              ...expected,
              target:
                target === "human"
                  ? { kind: "human", userId: responsibility.owner_user_id }
                  : { kind: "agent", responsibilityId: responsibility.id },
              reason:
                target === "human"
                  ? "The human is taking over this conversation."
                  : "Move this conversation to goal-driven agent management.",
            }
          : {
              action: "handover_commit",
              requestKey: randomUuid(),
              ...expected,
            },
      );
    } catch {
      /* Saved ownership remains authoritative. */
    }
  }
  async function heldControl(
    conversation: Conversation,
    action: "resume_held" | "refresh_held_history",
  ) {
    const expected = {
      conversationId: conversation.id,
      revision: conversation.revision,
      epoch: Number(conversation.epoch),
      contextRevision: conversation.context_revision,
    };
    try {
      await mutate("execution", {
        action,
        requestKey: randomUuid(),
        ...expected,
        ...(action === "resume_held"
          ? {
              reason:
                "I reviewed the reconciled email and fresh conversation history.",
            }
          : {}),
      });
    } catch {
      /* Current saved state and visible error remain authoritative. */
    }
  }
  const handoffResolved = (conversation: Conversation) =>
    conversation.engagement !== "handoff" ||
    Boolean(
      conversation.contact_id &&
        data?.inbox.tasks.some(
          (task) =>
            task.context.contactId === conversation.contact_id &&
            task.state === "dismissed",
        ) &&
        !data.inbox.tasks.some(
          (task) =>
            task.context.contactId === conversation.contact_id &&
            task.state !== "dismissed",
        ),
    );
  const channelGrantRoutes: AgentChannelGrantRoute[] = conversations
    .filter(
      (c) =>
        c.driver_kind === "agent" &&
        c.phase === "active" &&
        !["handoff", "stopped"].includes(c.engagement),
    )
    .flatMap((c) =>
      (c.channels ?? []).flatMap((r) =>
        r.bindingId
          ? [
              {
                id: r.id,
                bindingId: r.bindingId,
                channel: r.channel,
                recipient: r.recipient,
                senderLabel: r.senderLabel,
              },
            ]
          : [],
      ),
    );
  const eligible = conversations.filter(
    (c) =>
      c.driver_kind === "agent" &&
      c.phase === "active" &&
      c.binding_digest &&
      !["handoff", "stopped"].includes(c.engagement),
  );
  const selectedIds = Object.keys(selected),
    selectionStale = selectedIds.some(
      (id) =>
        !eligible.some(
          (c) => c.id === id && c.context_revision === selected[id],
        ),
    );
  const firstBinding = eligible.find((c) => selected[c.id])?.binding_digest;
  async function createGrant(event: React.FormEvent) {
    event.preventDefault();
    if (
      disabled ||
      selectionStale ||
      !confirmed ||
      !selectedIds.length ||
      !actions.length ||
      !mandateRevision ||
      !expiry ||
      !Number.isInteger(cap) ||
      cap < 1 ||
      cap > 100
    )
      return;
    const date = new Date(expiry);
    if (!Number.isFinite(date.getTime())) {
      setError("Choose an expiry in the next seven days.");
      return;
    }
    try {
      await mutate("authority", {
        action: "create",
        requestKey: randomUuid(),
        mandateRevision,
        conversationIds: selectedIds,
        actions,
        maxSends: cap,
        expiresAt: date.toISOString(),
      });
      setSelected({});
      setConfirmed(false);
    } catch {
      /* Keep reviewed scope and form inputs. */
    }
  }
  if (!data)
    return (
      <>
        <section
          aria-label="Agent controls"
          className="border-t border-[var(--border)] p-4 text-sm"
        >
          <p>Loading agent controls…</p>
          {pollUnavailable && (
            <p role="status">
              Could not refresh agent status. Check the connection before
              retrying.
            </p>
          )}
        </section>
        {renderConversation(null, {
          allowTestAutoApproval: false,
          automation: AGENT_DEMO_AUTO_APPROVAL_OFF,
          onAutomationStopped: stopAutomation,
        })}
      </>
    );
  const readinessDetails = data.configuration?.scopeMode === "registered" && (
    <details
      aria-label="Agent readiness"
      className="border-b border-[var(--border)] px-5 py-2 text-xs"
    >
      <summary className="min-h-7 cursor-pointer py-1 font-medium">
        {setupNeeded
          ? "Setup needs attention · view status and limits"
          : "Status and limits"}
        {data.configuration.simulation && " · Simulated accounts"}
      </summary>
      <div className="space-y-2 py-2">
        <p>
          {agentReadinessReason(data.readiness?.reason) ||
            "This mandate uses its own registered background runtime."}
        </p>
        {data.configuration.simulation && (
          <p>Simulated accounts · human approval required before sending.</p>
        )}
        {!data.configuration.modelConfigured && (
          <p role="status">
            Configure the model credentials for background planning.
          </p>
        )}
        {!data.configuration.researchConfigured && (
          <p>
            New company research needs a configured metered Firmable service and
            approved research limits. Existing synthetic contacts can be used
            without live research.
          </p>
        )}
        {readinessRows.map((channel) => (
          <p key={channel.channel}>
            {channel.channel}:{" "}
            {!channel.selected
              ? "Not selected for this mandate."
              : channel.readiness === "connected"
                ? "Connected · full conversation history checked before dispatch"
                : channel.ready
                  ? "Account ready"
                  : agentReadinessReason(channel.reason) ||
                    "Connect a recorded account in Settings."}
          </p>
        ))}
        {data.readiness?.defaults && (
          <p>
            Default 24-hour limits: {data.readiness.defaults.calls} provider
            calls · {data.readiness.defaults.sends} sends · $
            {(Number(data.readiness.defaults.usd_micro) / 1000000).toFixed(2)}{" "}
            maximum estimated cost. These limits do not approve messages.
          </p>
        )}
        {!!data.readiness?.budgets.length && (
          <p>
            Available budgets:{" "}
            {data.readiness.budgets
              .map(
                (b) =>
                  `${b.scope} ${b.unit === "usd_micro" ? "estimated cost" : b.unit === "calls" ? "provider calls" : "sends"}: ${b.unit === "usd_micro" ? "$" + (Number(b.available) / 1000000).toFixed(2) : b.available}`,
              )
              .join(" · ")}
          </p>
        )}
        <a href="/settings" className="underline">
          Connection settings
        </a>
      </div>
    </details>
  );

  const channelsNeedReview = Boolean(
    data.channelPolicy?.enabled &&
      (!policy ||
        policy.channelOrder.some((channel) => {
          const binding = policy.bindings.find((b) => b.channel === channel);
          return (
            !binding ||
            !data.channelPolicy!.accounts.some(
              (a) =>
                a.channel === channel &&
                a.bindingId === binding.bindingId &&
                a.bindingDigest === binding.bindingDigest,
            )
          );
        }) ||
        requiredChannels.some((channel) => !channel.ready)),
  );
  const preparedDemoCount =
    data.state?.executionMode === "demo"
      ? (data.state.demoContacts?.prepared ?? 0)
      : 0;
  const demoNeedsPreparation = Boolean(
    data.state?.executionMode === "demo" &&
      (!preparedDemoCount || data.state.demoContacts?.stale) &&
      data.demoPreparationEnabled,
  );
  const demoContactReview = Boolean(
    data.enabled &&
      running &&
      data.state?.executionMode === "demo" &&
      data.state.demoContacts?.outreachReady &&
      policy &&
      !channelsNeedReview &&
      !setupNeeded &&
      !data.channelPolicyUnavailable &&
      !data.readinessUnavailable &&
      (preparedDemoCount > conversations.length ||
        pendingContactReview ||
        Boolean(data.state?.contactAllocation)),
  );
  const allocating =
    !pendingContactReview &&
    ["queued", "running"].includes(data.state?.contactAllocation?.state ?? "");
  const partialAllocation =
    !pendingContactReview &&
    data.state?.contactAllocation?.state === "needs_review";
  const contactReview = pendingReviews?.some(batch=>batch.state==='pending'&&batch.operations.some(op=>op.name==='target.select')) ? null : demoContactReview && autoContacts ? (allocating ? <AgentChatSurface label="Preparing demo conversations"><AgentChatStatus working><p>I’m preparing conversations for the selected contacts.</p></AgentChatStatus></AgentChatSurface> : null) : demoContactReview ? (
    <section
      aria-label="Outreach contact review"
      className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm"
    >
      <p className="text-[11px] font-medium text-[var(--muted)]">Acquire</p>
      <h2 className="font-semibold">
        {allocating
          ? "Contact selection approved"
          : pendingContactReview
            ? "Contact selection ready"
            : partialAllocation
              ? "Some contacts need review"
              : conversations.length
                ? "Continue reviewing contacts"
                : "Ready to prepare outreach"}
      </h2>
      <p className="text-sm text-[var(--muted)]">
        {allocating
          ? data.state?.contactAllocation?.state === "queued"
            ? "Your approved contact selection is waiting to be allocated. Drafts will appear here for message review."
            : "Contact allocation is in progress. Drafts still need your review before sending."
          : pendingContactReview
            ? "Review the proposed contacts below before conversations are created."
            : partialAllocation
              ? `${data.state!.contactAllocation!.needsReview} contacts could not be allocated. Review current eligibility before preparing a fresh selection; original outcomes remain recorded.`
              : `${preparedDemoCount} simulated contacts are prepared. Review the next eligible group of up to ${agentContactReviewBatchSize} using your saved channel choices. This step does not send messages.`}
      </p>
      {allocating ? (
        <p role="status" className="text-xs text-[var(--muted)]">
          Waiting for saved allocation results…
        </p>
      ) : pendingContactReview ? (
        <button
          type="button"
          className={`${button} ${actionStyles.action}`}
          onClick={onShowReviews}
        >
          Review contact selection
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || !policy || !running}
          className={`${button} ${actionStyles.action}`}
          onClick={() =>
            void mutate("targets", {
              requestKey: randomUuid(),
              delivery: { mode: "channels", policyRevision: policy!.revision },
            }).catch(() => {})
          }
        >
          {partialAllocation
            ? "Review remaining contacts"
            : conversations.length
              ? "Review more contacts"
              : "Review outreach contacts"}
        </button>
      )}
      <p className="text-xs text-[var(--muted)]">
        You’ll review the contact selection and messages before sending.
        {policy &&
          !policy.acceleratedSimulation &&
          ` Channels wait ${policy.delaySeconds / 3600}h between attempts unless a reply stops them.`}
      </p>
    </section>
  ) : null;
  const outreachProgress = (
    <AgentOutreachProgress
      automaticMessages={allowTestAutoApproval&&automation.initialMessages&&automation.replies&&automation.followUps&&automation.reviewFlaggedDrafts}
      focusedConversationId={focusedConversationId}
      conversationFocusRequest={conversationFocusRequest}
      mandateId={mandateId}
      conversations={conversations}
      busy={disabled}
      running={!!running}
      onHandover={handover}
      onHeldControl={heldControl}
      onCommand={(value) =>
        mutate("execution", { requestKey: randomUuid(), ...value })
      }
      canHandBack={handoffResolved}
    />
  );
  const openHandoffs = data.inbox.tasks.filter(
    (task) => !["dismissed", "meeting_confirmed"].includes(task.state),
  ).length;
  const handoffs = (
    <AgentHandoffTasks
      inbox={data.inbox}
      busy={disabled}
      onFeedback={onFeedback}
      onAction={async (action: AgentHandoffAction) => {
        await mutate("handoffs", { requestKey: randomUuid(), ...action });
      }}
    />
  );

  const showSetup = Boolean(
    !testingBlocked &&
      !initialResearchActive &&
      !initialResearchNeedsAttention &&
      !fundingWaiting &&
      data.enabled &&
      responsibility &&
      (channelsNeedReview ||
        demoNeedsPreparation ||
        setupNeeded ||
        data.channelPolicyUnavailable ||
        data.readinessUnavailable),
  );
  function showChatSetup() {
    closeSettings();
    requestAnimationFrame(() =>
      setupAnchor.current?.scrollIntoView({ block: "start", behavior: "auto" }),
    );
  }
  function showAdvanced() {
    openSettings();
    if (advanced.current) advanced.current.open = true;
  }
  const channelEditor = data.channelPolicy?.enabled && (
    <AgentChannelPolicyControls
      key={data.channelPolicy.policy?.revision ?? 0}
      value={data.channelPolicy}
      busy={busy || working}
      allowAcceleration={
        data.configuration?.simulation === true &&
        data.configuration.scopeMode === "registered"
      }
      onSave={(value) =>
        mutate("channel-policy", { requestKey: randomUuid(), ...value })
      }
    />
  );
  const cachedDemo =
    data.state?.executionMode === "demo" && initialResearchSource === "cached";
  const awaitingStart =
    initialResearchStatus === "awaiting_start" && !responsibility;
  const welcomeActions = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        className={`${button} ${actionStyles.action} bg-[var(--accent)] text-[var(--on-accent)]`}
        onClick={() =>
          awaitingStart
            ? void control("start")
            : void mutate("demo", {
                action: "start",
                requestKey: randomUuid(),
              }).catch(() => {})
        }
      >
        {working ? "Starting…" : "Start"}
      </button>
    </div>
  );
  const setup =
    awaitingStart || (showSetup && cachedDemoReady) ? (
      <>
        <AgentWelcome description={mandateDescription} savedData={savedData}>
          {welcomeActions}
        </AgentWelcome>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
      </>
    ) : showSetup ? (
      <section
        ref={setupAnchor}
        aria-label="Agent setup request"
        className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm"
      >
        <p className="text-[11px] font-medium text-[var(--muted)]">Acquire</p>
        <h2 className="font-semibold">
          {cachedDemoReady
            ? "Ready to start"
            : channelsNeedReview
              ? "Which accounts should I use?"
              : demoNeedsPreparation
                ? "Prepare this demo for outreach?"
                : "I need your help with setup"}
        </h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          {cachedDemoReady
            ? "I’ll use your saved channel settings and prepare outreach to the people in this demo."
            : "Research can continue. Before outreach, review these choices; messages still need your approval."}
        </p>
        {cachedDemoReady ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={disabled}
              className={`${button} ${actionStyles.action} bg-[var(--accent)] text-[var(--on-accent)]`}
              onClick={() =>
                void mutate("demo", {
                  action: "start",
                  requestKey: randomUuid(),
                }).catch(() => {})
              }
            >
              {working ? "Starting…" : "Start"}
            </button>
            <button
              type="button"
              onClick={onViewCompanies}
              className={`${actionStyles.action} inline-flex min-h-11 items-center underline underline-offset-4`}
            >
              View companies
            </button>
            <button
              type="button"
              onClick={onViewPeople}
              className={`${actionStyles.action} inline-flex min-h-11 items-center underline underline-offset-4`}
            >
              View people
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {channelsNeedReview && channelEditor}
            {channelsNeedReview && !data.channelPolicy?.accounts.length && (
              <a
                href="/settings"
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              >
                Connect an account
              </a>
            )}
            {demoNeedsPreparation && (
              <div>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  Use simulated recipients for the researched people.
                </p>
                <button
                  type="button"
                  className={button}
                  disabled={disabled}
                  onClick={() =>
                    void mutate("demo", { requestKey: randomUuid() }).catch(
                      () => {},
                    )
                  }
                >
                  Prepare simulated contacts
                </button>
              </div>
            )}
            {(data.channelPolicyUnavailable || data.readinessUnavailable) && (
              <p role="status" className="text-xs">
                Current account setup could not be verified. Review status
                before continuing.
              </p>
            )}
            {setupNeeded &&
              (!data.readiness?.registered ||
                data.configuration?.modelConfigured === false) && (
                <button type="button" className={button} onClick={showAdvanced}>
                  Review runtime setup
                </button>
              )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--status-red)]">
            {error}
          </p>
        )}
      </section>
    ) : null;
  return (
    <>
      <section aria-label="Agent controls" className="min-w-0 shrink-0">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${!data.enabled ? "bg-[var(--muted)]" : initialResearchNeedsAttention ? "bg-amber-500" : initialResearchActive && initialResearchStatus === "queued" ? "bg-amber-500" : running && (!setupNeeded || initialResearchActive || cachedDemoReady) ? "bg-emerald-500" : paused ? "bg-amber-500" : "bg-[var(--muted)]"}`}
            />
            <h2 className="truncate text-sm font-medium">
              {!data.enabled
                ? "Agent off"
                : openHandoffs
                  ? "Your turn"
                  : manualPending || data.state?.contactSelectionEmpty
                    ? "Needs your review"
                    : automaticPending.length
                      ? "Preparing outreach"
                    : conversations.length
                      ? "Outreach"
                      : initialResearchNeedsAttention
                        ? "Research needs attention"
                        : awaitingStart
                          ? "Ready to begin"
                          : cachedDemoReady
                            ? "Demo ready"
                            : initialResearchActive
                              ? initialResearchStatus === "queued"
                                ? "Research queued"
                                : "Agent active"
                              : data.readinessUnavailable
                                ? "Status unavailable"
                                : setupNeeded
                                  ? "Agent needs setup"
                                  : running
                                    ? "Agent active"
                                    : paused
                                      ? "Agent paused"
                                      : "Agent ready"}
            </h2>
            {data.state?.executionMode === "demo" && (
              <span className="rounded-full bg-[var(--panel-raised)] px-2 py-1 text-[10px] font-medium text-[var(--muted)]">
                Demo · simulated outreach
              </span>
            )}
            <p className="sr-only">
              {!data.enabled
                ? "Native execution is disabled. Saved tasks and permissions remain visible."
                : initialResearchNeedsAttention
                  ? "Review the saved research outcome in chat before further work."
                  : cachedDemoReady
                    ? "Saved demo company and people data are ready. No live research was requested."
                    : initialResearchActive
                      ? initialResearchStatus === "queued"
                        ? "The initial research request is saved and awaiting execution. Outreach setup is separate."
                        : "Company research is active. Outreach setup is separate."
                      : setupNeeded
                        ? "Background setup needs attention before this mandate can send messages."
                        : running
                          ? "Agent supervision is active. Human approval is the default."
                          : paused
                            ? "Agent supervision is paused."
                            : "Start supervision for the current saved mandate."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {allowTestAutoApproval && (
              <AgentDemoApprovalControls
                value={automation}
                persistent={automationPersistent}
                disabled={disabled}
                onChange={setAutomation}
              />
            )}
            {briefChanged && (
              <button
                type="button"
                className={button}
                disabled={disabled || !mandateRevision}
                onClick={() => void control("resume")}
              >
                Resume with reviewed brief
              </button>
            )}
            {(running || paused) && (
              <button
                type="button"
                className={button}
                disabled={disabled || !mandateRevision}
                onClick={() => void control(running ? "pause" : "resume")}
              >
                {running ? "Pause agent" : "Resume agent"}
              </button>
            )}
            {!cachedDemo && <button
              type="button"
              aria-label="Agent settings"
              aria-controls={settingsId}
              aria-expanded={settingsOpen}
              onClick={openSettings}
              className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)]"
              title="Agent settings"
            >
              <SlidersHorizontal size={19} />
            </button>}
          </div>
        </div>
        {briefChanged && (
          <p
            role="status"
            className="border-b border-[var(--border)] px-5 py-2 text-xs"
          >
            The saved brief changed. Review it, then resume supervision with the
            updated brief. Research and messages still require their separate
            approvals.
          </p>
        )}
        {!cachedDemo && <dialog
          ref={dialog}
          id={settingsId}
          aria-labelledby={settingsTitleId}
          onCancel={(event) => {
            event.preventDefault();
            closeSettings();
          }}
          onClose={() => setSettingsOpen(false)}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              closeSettings();
          }}
          className={`${settingsStyles.drawer} fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-[480px] border-0 border-l border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--foreground)] shadow-2xl backdrop:bg-black/30`}
        >
          <div className="h-full overflow-y-auto overscroll-contain">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-5 py-4">
              <div>
                <h2
                  id={settingsTitleId}
                  className="text-lg font-semibold tracking-tight"
                >
                  Agent settings
                </h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Configure the current mandate.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close settings"
                onClick={closeSettings}
                className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--panel-raised)]"
              >
                <X size={20} />
              </button>
            </header>
            <div className="space-y-5 p-5">
              <p className="w-fit rounded-full bg-[var(--panel-raised)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
                {data.state?.executionMode === "demo"
                  ? "Demo · simulated outreach"
                  : "Human approval required"}
              </p>
              {cachedDemo ? (
                <>
                  <section className="space-y-2 text-sm">
                    <h3 className="font-medium">Outreach</h3>
                    <p className="text-[var(--muted)]">
                      Uses your saved channel settings. This demo sends only to
                      simulated recipients.
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {policy
                        ? `${policy.channelOrder.map((c) => (c === "whatsapp" ? "WhatsApp" : c === "linkedin" ? "LinkedIn" : "Email")).join(" → ")} · ${policy.acceleratedSimulation ? `${policy.delaySeconds}s` : `${policy.delaySeconds / 3600}h`} between channels`
                        : "Accounts are selected automatically when you press Start."}
                    </p>
                  </section>
                  <a
                    href="/settings"
                    className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                  >
                    System settings
                  </a>
                </>
              ) : (
                <>
                  {showSetup && channelsNeedReview ? (
                    <button
                      type="button"
                      className={button}
                      onClick={showChatSetup}
                    >
                      Review channel accounts in chat
                    </button>
                  ) : (
                    channelEditor
                  )}
                  <details
                    ref={advanced}
                    aria-label="Advanced agent settings"
                    className="border-t border-[var(--border)] pt-3"
                  >
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
                      Advanced
                    </summary>
                    <div className="space-y-4 pt-3">
                      {readinessDetails}{" "}
                      {data.channelPolicy?.policy && (
                        <AgentChannelBudgetControls
                          accounts={data.channelPolicy.accounts}
                          selectedBindingIds={data.channelPolicy.policy.bindings.map(
                            (b) => b.bindingId,
                          )}
                          canConfigure={
                            data.channelPolicy.canConfigureBudgets === true
                          }
                          busy={busy || working}
                          onSave={(value) =>
                            mutate("channel-budgets", {
                              requestKey: randomUuid(),
                              ...value,
                            })
                          }
                        />
                      )}{" "}
                      {data.channelPolicyUnavailable && (
                        <p role="status">
                          Channel settings could not be loaded. Refresh before
                          choosing accounts.
                        </p>
                      )}
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <h3 className="text-sm font-medium">
                          Review cached contacts
                        </h3>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Choose the reviewed channel policy, a recorded email
                          account or explicit local simulation. Contact
                          selection requires human review before conversations
                          are allocated; it does not send email.
                        </p>
                        <label className="mt-2 block text-xs">
                          Delivery mode / account
                          <select
                            className={field}
                            value={targetDelivery}
                            disabled={disabled}
                            onChange={(event) =>
                              setTargetDelivery(event.target.value)
                            }
                          >
                            <option value="">Choose explicitly…</option>
                            {data.channelPolicy?.policy && (
                              <option value="channels">
                                Reviewed policy ·{" "}
                                {data.channelPolicy.policy.channelOrder
                                  .map((c) =>
                                    c === "whatsapp"
                                      ? "WhatsApp"
                                      : c === "linkedin"
                                        ? "LinkedIn"
                                        : "Email",
                                  )
                                  .join(" → ")}
                              </option>
                            )}
                            {data.state?.executionMode !== "demo" &&
                              (data.targetOptions?.simulationEnabled ??
                                data.simulationEnabled) && (
                                <option value="local_sink">
                                  Local simulation — no provider email
                                </option>
                              )}
                            {(data.state?.executionMode === "demo"
                              ? []
                              : (data.targetOptions?.bindings ?? [])
                            ).map((binding) => (
                              <option
                                key={binding.id}
                                value={"binding:" + binding.id}
                              >
                                {binding.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={`${button} mt-3`}
                          disabled={
                            disabled ||
                            !running ||
                            !targetDelivery ||
                            (data.state?.executionMode === "demo" &&
                              !data.state.demoContacts?.outreachReady)
                          }
                          onClick={() => {
                            const delivery =
                              targetDelivery === "channels"
                                ? {
                                    mode: "channels",
                                    policyRevision:
                                      data.channelPolicy?.policy?.revision,
                                  }
                                : targetDelivery === "local_sink"
                                  ? { mode: "local_sink" }
                                  : {
                                      mode: "communications",
                                      bindingId: targetDelivery.slice(8),
                                    };
                            void mutate("targets", {
                              requestKey: randomUuid(),
                              delivery,
                            }).catch(() => {});
                          }}
                        >
                          Prepare contact selection
                        </button>
                      </div>
                      <details className="rounded-lg border border-[var(--border)] p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                          Conversation ownership and sending limits
                        </summary>
                        <p className="mt-3 text-xs text-[var(--muted)]">
                          Human approval is the default. Automatic sending is
                          limited to the exact conversations, email actions,
                          send cap and expiry you choose. Existing sequences
                          keep their own controls.
                        </p>
                        <a
                          href={`/mandates/${mandateId}/outreach/sequences`}
                          className="mt-3 block text-xs underline"
                        >
                          Open original sequence controls
                        </a>
                        {channelGrantRoutes.length > 0 && mandateRevision && (
                          <AgentChannelGrantControls
                            routes={channelGrantRoutes}
                            mandateRevision={mandateRevision}
                            disabled={disabled || !running}
                            onCreate={(value) =>
                              mutate("authority", {
                                action: "create_channels",
                                requestKey: randomUuid(),
                                ...value,
                              })
                            }
                          />
                        )}
                        {channelGrantRoutes.length === 0 && (
                          <form
                            aria-label="Automatic sending permissions"
                            onSubmit={createGrant}
                            className="mt-4 space-y-3"
                          >
                            <h3 className="text-sm font-medium">
                              Automatic sending limits
                            </h3>
                            {eligible.length === 0 ? (
                              <p className="text-xs text-[var(--muted)]">
                                No active agent conversations are available for
                                delegated sending.
                              </p>
                            ) : (
                              <fieldset
                                disabled={disabled}
                                className="space-y-2"
                              >
                                <legend className="text-xs">
                                  Choose conversations sharing the same recorded
                                  email account
                                </legend>
                                {eligible.map((c) => (
                                  <label
                                    key={c.id}
                                    className="flex min-h-11 items-center gap-2 break-all text-xs"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(selected[c.id])}
                                      disabled={Boolean(
                                        firstBinding &&
                                          firstBinding !== c.binding_digest,
                                      )}
                                      onChange={(event) => {
                                        setSelected((old) => {
                                          const next = { ...old };
                                          if (event.target.checked)
                                            next[c.id] = c.context_revision;
                                          else delete next[c.id];
                                          return next;
                                        });
                                        setConfirmed(false);
                                      }}
                                    />
                                    {c.recipient_email}
                                  </label>
                                ))}
                              </fieldset>
                            )}
                            <fieldset disabled={disabled} className="space-y-2">
                              <legend className="text-xs">
                                Allowed email actions
                              </legend>
                              {[
                                ["reply_email", "Replies"],
                                ["initial_email", "First emails"],
                                ["follow_up_email", "Follow-ups"],
                              ].map(([value, label]) => (
                                <label
                                  key={value}
                                  className="mr-3 inline-flex min-h-11 items-center gap-2 text-xs"
                                >
                                  <input
                                    type="checkbox"
                                    checked={actions.includes(value)}
                                    onChange={(event) => {
                                      setActions((old) =>
                                        event.target.checked
                                          ? [...old, value]
                                          : old.filter(
                                              (action) => action !== value,
                                            ),
                                      );
                                      setConfirmed(false);
                                    }}
                                  />
                                  {label}
                                </label>
                              ))}
                            </fieldset>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="text-xs">
                                Maximum sends
                                <input
                                  type="number"
                                  min={1}
                                  max={100}
                                  required
                                  value={cap}
                                  disabled={disabled}
                                  className={field}
                                  onChange={(event) => {
                                    setCap(Number(event.target.value));
                                    setConfirmed(false);
                                  }}
                                />
                              </label>
                              <label className="text-xs">
                                Expires at (your local time, up to 7 days)
                                <input
                                  type="datetime-local"
                                  required
                                  value={expiry}
                                  disabled={disabled}
                                  className={field}
                                  onChange={(event) => {
                                    setExpiry(event.target.value);
                                    setConfirmed(false);
                                  }}
                                />
                              </label>
                            </div>
                            <label className="flex min-h-11 items-start gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={confirmed}
                                disabled={disabled}
                                onChange={(event) =>
                                  setConfirmed(event.target.checked)
                                }
                              />
                              Allow sending without reviewing each draft, within
                              these exact limits. Sending policies, budgets and
                              opt-outs still apply.
                            </label>
                            {selectionStale && (
                              <p role="status" className="text-xs">
                                A selected conversation changed. Clear and
                                reselect it before granting permission.
                              </p>
                            )}
                            <button
                              type="submit"
                              className={button}
                              disabled={
                                disabled ||
                                !confirmed ||
                                !selectedIds.length ||
                                !actions.length ||
                                selectionStale ||
                                !mandateRevision ||
                                !Number.isInteger(cap) ||
                                cap < 1 ||
                                cap > 100
                              }
                            >
                              Enable bounded automatic sending
                            </button>
                            {selectedIds.length > 0 && (
                              <button
                                type="button"
                                className={`${button} ml-2`}
                                disabled={busy || working}
                                onClick={() => {
                                  setSelected({});
                                  setConfirmed(false);
                                }}
                              >
                                Clear selection
                              </button>
                            )}
                          </form>
                        )}
                        {data.grants.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <h3 className="text-sm font-medium">
                              Saved sending permissions
                            </h3>
                            {data.grants.map((grant) => (
                              <div
                                key={grant.id}
                                className="rounded-lg border border-[var(--border)] p-3 text-xs"
                              >
                                <p>
                                  {grant.used_sends} / {grant.max_sends} sends
                                  used ·{" "}
                                  {grant.revoked_at
                                    ? "revoked"
                                    : `expires ${grant.expires_at}`}
                                </p>
                                <p className="mt-1">
                                  {grant.recipient_keys.join(", ")} ·{" "}
                                  {grant.actions.join(", ")}
                                </p>
                                {!grant.revoked_at && (
                                  <button
                                    type="button"
                                    className={`${button} mt-2`}
                                    disabled={disabled}
                                    onClick={() => {
                                      void mutate("authority", {
                                        action: "revoke",
                                        requestKey: randomUuid(),
                                        grantId: grant.id,
                                        revision: grant.revision,
                                      }).catch(() => {});
                                    }}
                                  >
                                    Revoke permission
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                      <AgentSequenceControls
                        mandateId={mandateId}
                        enabled={data.enabled}
                        busy={busy || working}
                        bindings={data.targetOptions?.bindings ?? []}
                        onCommand={(value) => mutate("sequences", value)}
                      />
                      {data.enabled && (
                        <AgentSequenceHandoverControls
                          busy={busy || working}
                          onPreview={async (enrolmentId) => {
                            const response = await fetch(
                              endpoint("sequence-handover") +
                                "?enrolmentId=" +
                                encodeURIComponent(enrolmentId),
                              {
                                cache: "no-store",
                                signal: AbortSignal.timeout(15000),
                              },
                            );
                            if (!response.ok)
                              throw new Error("Ownership preview unavailable");
                            return (await readJsonResponse(response,'Current agent status is temporarily unavailable. Please try again.')).preview;
                          }}
                          onAdopt={(value) =>
                            mutate("sequence-handover", {
                              requestKey: randomUuid(),
                              ...value,
                            })
                          }
                        />
                      )}
                      {fundingWaiting ? (
                        <button
                          type="button"
                          className={button}
                          onClick={() => {
                            closeSettings();
                            requestAnimationFrame(() =>
                              fundingAnchor.current?.scrollIntoView({
                                block: "start",
                                behavior: "auto",
                              }),
                            );
                          }}
                        >
                          Review research budget in chat
                        </button>
                      ) : (
                        <AgentBudgetControls
                          mandateId={mandateId}
                          enabled={data.enabled}
                          busy={busy || working}
                          onConfigure={(value) => mutate("budgets", value)}
                        />
                      )}
                    </div>
                  </details>
                </>
              )}
            </div>
          </div>
        </dialog>}
        {pollUnavailable && (
          <p role="status" className="text-xs">
            Could not refresh background status. Check the connection before
            retrying.
          </p>
        )}
        {error && !showSetup && (
          <p
            role="alert"
            className="px-5 py-2 text-sm text-[var(--status-red)]"
          >
            {error}
          </p>
        )}
      </section>
      {renderConversation(
        <>
          {testingBlocked && (
            <section
              aria-label="Testing service status"
              className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm"
            >
              <p className="text-[11px] font-medium text-[var(--muted)]">
                Acquire
              </p>
              <h2 className="font-semibold">Waiting for the testing service</h2>
              <p className="text-sm text-[var(--muted)]">
                {data.demoService?.message}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={`${actionStyles.action} min-h-11 underline underline-offset-4`}
                  onClick={onViewCompanies}
                >
                  View companies
                </button>
                <button
                  type="button"
                  className={`${actionStyles.action} min-h-11 underline underline-offset-4`}
                  onClick={onViewPeople}
                >
                  View people
                </button>
              </div>
            </section>
          )}
          {setup}
          {contactReview}
          {pendingMessageReviews > 0 && pendingReviews===undefined && (
            <section
              aria-label="Message approval step"
              className="rounded-xl border border-[var(--border)] p-4 text-sm"
            >
              <h2 className="font-semibold">Messages ready for review</h2>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {pendingMessageReviews} message{" "}
                {pendingMessageReviews === 1 ? "proposal is" : "proposals are"}{" "}
                waiting for your approval below.
              </p>
              <button
                type="button"
                className={`${actionStyles.action} mt-2 min-h-11 underline underline-offset-4`}
                onClick={onShowReviews}
              >
                Review messages
              </button>
            </section>
          )}
          {outreachProgress}
          {data.inbox.tasks.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] p-4">
              {handoffs}
            </div>
          )}
          {data.enabled && responsibility && (
            <div ref={fundingAnchor}>
              <AgentResearchControls
                mandateId={mandateId}
                disabled={disabled}
                inline
                onFundingChange={setFundingWaiting}
                onContinue={(value) =>
                  mutate("research", { requestKey: randomUuid(), ...value })
                }
                onConfigureBudget={(value) => mutate("budgets", value)}
              />
            </div>
          )}
        </>,
        {
          allowTestAutoApproval,
          automation,
          onAutomationStopped: stopAutomation,
        },
      )}
    </>
  );
}
