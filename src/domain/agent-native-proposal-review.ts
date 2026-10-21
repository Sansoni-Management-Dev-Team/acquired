import { companyDiscoveryPolicySchema } from "./research-discovery-policy";
import { hybridCompanyContinuationSchema } from "./hybrid-company-continuation";
import {
  agentPersonChannelRecipientSchema,
  agentChannelIdentityProofSchema,
} from "./agent-person-channel";
import { campaignDraftDefinition } from "./campaign";

/** Presentation review checks only. Approval and dispatch retain their own
 * server-owned authorization, scope, history and admission validation. */
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
      policy = record(input.providerPolicy),
      attempts = record(policy.maxAttempts);
    const firmable =
        execution.productionPipeline === "firmable-v1" &&
        execution.pipeline === "firmable-company-v1",
      hybrid =
        execution.productionPipeline === "hybrid-firmable-v1" &&
        execution.pipeline === "hybrid-company-v1";
    if (
      Object.hasOwn(config, "companyDiscoveryPolicy") &&
      (!hybrid ||
        !companyDiscoveryPolicySchema.safeParse(config.companyDiscoveryPolicy)
          .success)
    )
      return false;
    if (record(config.companyDiscoveryPolicy).version === 5) {
      const pricing = record(policy.requestCeilingsMicroUsd);
      return (
        input.nativeResearchPlanVersion === 1 &&
        Boolean(
          text(config.requestId) &&
            text(config.researchScope) &&
            text(config.geography),
        ) &&
        config.targetBusinesses === 20 &&
        hybrid &&
        execution.peopleResearch === true &&
        execution.backgroundResearch === false &&
        config.companyIdentityPolicyVersion === 1 &&
        !Object.hasOwn(config, "companyOnly") &&
        !Object.hasOwn(config, "companyContinuation") &&
        config.includeCompanyPeople === true &&
        config.includePhones === false &&
        config.findPeople === false &&
        record(config.budget).maxMinutes === 15 &&
        policy.version === 3 &&
        policy.callAdmission === "per_request" &&
        policy.usdAdmission === "company_phase_people_per_request" &&
        policy.pricingBasis === "configured_company_plus_metered_people" &&
        policy.requestCeilingMicroUsd === "1000000" &&
        policy.firmableCompanyRequestCeilingMicroUsd === "0" &&
        ["firmable", "search", "page", "ai"].every(
          (provider) => pricing[provider] === "1000000",
        ) &&
        attempts.firmable === 24024 &&
        attempts.search === 6 &&
        attempts.page === 5 &&
        attempts.ai === 0
      );
    }
    const all = record(config.companyDiscoveryPolicy).version === 4;
    if (
      Object.hasOwn(config, "companyContinuation") &&
      (!all ||
        !hybrid ||
        !hybridCompanyContinuationSchema.safeParse(config.companyContinuation)
          .success)
    )
      return false;
    const pricing = record(policy.requestCeilingsMicroUsd),
      configured =
        policy.version === 2 &&
        policy.callAdmission === "per_request" &&
        policy.companyOnly === true &&
        policy.pricingBasis === "configured_company_only_incremental" &&
        pricing.firmable === "0" &&
        pricing.search === "1000000" &&
        pricing.page === "1000000" &&
        pricing.ai === "1000000" &&
        config.companyIdentityPolicyVersion === 1 &&
        config.companyOnly === true &&
        config.includeCompanyPeople === false &&
        config.includePhones === false &&
        config.findPeople === false &&
        record(config.budget).maxMinutes === 15;
    return (
      input.nativeResearchPlanVersion === 1 &&
      Boolean(
        text(config.requestId) &&
          text(config.researchScope) &&
          text(config.geography),
      ) &&
      config.targetBusinesses === 20 &&
      (firmable || hybrid) &&
      execution.peopleResearch === false &&
      execution.backgroundResearch === false &&
      policy.requestCeilingMicroUsd === "1000000" &&
      attempts.search === 6 &&
      attempts.page === 5 &&
      attempts.ai === (hybrid ? 0 : 5) &&
      (all
        ? hybrid && configured && attempts.firmable === 24024
        : policy.version === 1 && attempts.firmable === 60)
    );
  }
  if (name === "research.fields") {
    const execution = record(input.execution),
      policy = record(input.providerPolicy),
      attempts = record(policy.maxAttempts),
      perCompany = record(policy.perCompany),
      allowed = [
        "description",
        "company_emails",
        "company_phones",
        "year_founded",
        "acn",
        "website_address",
        "employee_count",
        "revenue",
        "accreditations",
      ];
    return (
      input.nativeFieldsPlanVersion === 1 &&
      Boolean(text(record(input.config).requestId)) &&
      execution.pipeline === "public-fields-v1" &&
      execution.peopleResearch === false &&
      execution.ai === false &&
      policy.version === 1 &&
      policy.requestCeilingMicroUsd === "1000000" &&
      perCompany.search === 12 &&
      perCompany.page === 64 &&
      attempts.search === 60 &&
      attempts.page === 320 &&
      attempts.ai === 0 &&
      attempts.firmable === 0 &&
      Array.isArray(input.selected) &&
      input.selected.length > 0 &&
      input.selected.length <= 5 &&
      input.selected.every((raw) => {
        const c = record(raw);
        return (
          Boolean(
            text(c.targetId) &&
              text(c.childJobId) &&
              text(c.sourceRevision) &&
              text(c.name) &&
              text(c.domain),
          ) &&
          typeof c.verifyAbn === "boolean" &&
          Array.isArray(c.fields) &&
          (c.fields.length > 0 || c.verifyAbn) &&
          c.fields.every((f) => allowed.includes(text(f)))
        );
      })
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
