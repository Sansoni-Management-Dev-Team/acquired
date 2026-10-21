import {
  agentPersonChannelRecipientSchema,
  agentChannelIdentityProofSchema,
} from "@/domain/agent-person-channel";
import { campaignDraftDefinition } from "@/domain/campaign";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function sequenceDraftForReview(input: Record<string, unknown>) {
  if (
    input.nativeSequenceDraftVersion !== 1 ||
    !text(input.name).trim() ||
    text(input.name).length > 120 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      text(input.sequenceId),
    ) ||
    !(
      (input.mode === "create" && input.baseRevision === null) ||
      (input.mode === "update" &&
        typeof input.baseRevision === "string" &&
        /^[0-9]{1,10}$/.test(input.baseRevision))
    )
  )
    return null;
  const parsed = campaignDraftDefinition.safeParse(input.definition);
  if (
    !parsed.success ||
    (!parsed.data.steps.length &&
      !parsed.data.splits?.some(
        (split) => split.pathA.length || split.pathB.length,
      ))
  )
    return null;
  return parsed.data;
}

export function nativeProposalReviewable(
  name: string,
  input: Record<string, unknown>,
) {
  if (name === "linkedin.invitation")
    return (
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        text(input.routeId),
      ) &&
      input.subject === "" &&
      input.requiresHumanReview === true &&
      text(input.body).trim().length > 0 &&
      text(input.body).length <= 300
    );
  if (/^(whatsapp|linkedin)\.(initial|reply|follow_up)$/.test(name))
    return (
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        text(input.routeId),
      ) &&
      input.subject === "" &&
      Boolean(text(input.body).trim())
    );
  if (name === "sequence.prepare")
    return sequenceDraftForReview(input) !== null;
  if (name === "sequence.publish")
    return (
      input.nativeSequencePublicationVersion === 1 &&
      Boolean(
        text(input.sequenceId) &&
          text(input.versionId) &&
          text(input.draftRevision) &&
          typeof input.publishedVersion === "number" &&
          ["n8n", "legacy"].includes(text(input.runtime)) &&
          record(input.definition).schemaVersion === 1,
      )
    );
  if (name === "sequence.enrol")
    return (
      input.nativeSequenceEnrolmentVersion === 1 &&
      Boolean(
        text(input.sequenceId) &&
          text(input.versionId) &&
          text(input.bindingId) &&
          text(input.bindingDigest) &&
          typeof input.version === "number" &&
          ["n8n", "legacy"].includes(text(input.runtime)) &&
          Array.isArray(input.selected) &&
          input.selected.length > 0 &&
          input.selected.every((item) => {
            const c = record(item);
            return Boolean(
              text(c.contactId) &&
                text(c.enrolmentId) &&
                text(c.recipient) &&
                text(c.sourceRevision),
            );
          }),
      )
    );
  if (name === "research.start") {
    const config = record(input.config),
      execution = record(input.execution),
      policy = record(input.providerPolicy);
    return (
      input.nativeResearchPlanVersion === 1 &&
      Boolean(
        text(config.requestId) &&
          text(config.researchScope) &&
          text(config.geography) &&
          typeof config.targetBusinesses === "number" &&
          execution.pipeline === "firmable-company-v1" &&
          execution.peopleResearch === false &&
          execution.backgroundResearch === false &&
          policy.requestCeilingMicroUsd === "1000000" &&
          typeof record(policy.maxAttempts).firmable === "number",
      )
    );
  }
  if (name === "research.people") {
    const policy = record(input.providerPolicy);
    return (
      input.nativePeoplePlanVersion === 1 &&
      input.includePhones === false &&
      typeof input.maxContactsPerCompany === "number" &&
      Boolean(text(record(input.config).requestId)) &&
      policy.requestCeilingMicroUsd === "1000000" &&
      Array.isArray(input.selected) &&
      input.selected.length > 0 &&
      input.selected.every((item) => {
        const c = record(item);
        return Boolean(
          text(c.targetId) &&
            text(c.name) &&
            text(c.firmableId) &&
            text(c.sourceRevision),
        );
      })
    );
  }
  if (name === "target.select") {
    const delivery = record(input.delivery),
      multi = delivery.mode === "channels";
    return (
      input.nativeTargetSelectionVersion === 1 &&
      ["local_sink", "communications", "channels"].includes(
        text(delivery.mode),
      ) &&
      (delivery.mode !== "communications" ||
        Boolean(text(delivery.bindingId) && text(delivery.bindingDigest))) &&
      (!multi ||
        (Number.isInteger(delivery.policyRevision) &&
          Number(delivery.policyRevision) > 0)) &&
      Array.isArray(input.selected) &&
      input.selected.length > 0 &&
      input.selected.every((item) => {
        const c = record(item),
          manual = c.sourceKind === "manual_contact";
        if (
          !text(c.contactId) ||
          !(manual
            ? c.targetId === null && c.qualificationConfirmed === false
            : Boolean(text(c.targetId))) ||
          !text(c.name) ||
          !Array.isArray(c.fit)
        )
          return false;
        if (!multi) return Boolean(text(c.recipient));
        return (
          Array.isArray(c.channels) &&
          c.channels.length > 0 &&
          c.channels.length <= 3 &&
          new Set(c.channels.map((r) => record(r).channel)).size ===
            c.channels.length &&
          c.channels.every((raw) => {
            const r = record(raw);
            return (
              /^[a-f0-9-]{36}$/i.test(text(r.bindingId)) &&
              /^[a-f0-9]{64}$/.test(text(r.bindingDigest)) &&
              agentPersonChannelRecipientSchema.safeParse({
                channel: r.channel,
                recipient: r.recipient,
              }).success &&
              agentChannelIdentityProofSchema.safeParse(r.identityProof).success
            );
          })
        );
      })
    );
  }
  return true;
}
