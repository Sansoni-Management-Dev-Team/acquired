import { companyDiscoveryPolicySchema } from "@/domain/research-discovery-policy";
import { AgentContactSelection } from "./agent-contact-selection";
import type { AgentChatPersonView } from "./agent-chat-ui";
import { hybridCompanyContinuationSchema } from "@/domain/hybrid-company-continuation";
import type { CampaignStep } from "@/domain/campaign";
import {
  nativeProposalReviewable,
  sequenceDraftForReview,
} from "@/domain/agent-native-proposal-review";

export { nativeProposalReviewable };
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function SequenceDraftStep({ step }: { step: CampaignStep }) {
  return (
    <li className="space-y-1 rounded border border-[var(--border)] p-2">
      <p className="font-semibold">
        {step.title} · {step.kind}
      </p>
      <p className="break-all text-[var(--muted)]">Step {step.id}</p>
      {step.kind === "wait" ? (
        <p>Wait {step.days} days</p>
      ) : (
        <>
          {step.kind === "email" && <p>Subject: {step.subject}</p>}
          {step.kind === "linkedin" && (
            <p>Action: {step.action || "message"}</p>
          )}
          <p className="whitespace-pre-wrap break-words">
            {step.body || "(Empty connection note)"}
          </p>
        </>
      )}
    </li>
  );
}
export function AgentProposalGuidance({
  input,
}: {
  input: Record<string, unknown>;
}) {
  const items = record(input.guidance).items,
    entries = [
      ...(Array.isArray(input.selected) ? input.selected : []),
      ...(Array.isArray(input.excluded) ? input.excluded : []),
    ];
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <details className="rounded-lg border border-[var(--border)] p-3 text-xs">
      <summary className="cursor-pointer">
        Applied guidance ({items.length})
      </summary>
      <p className="mt-2">
        These confirmed preferences do not change the saved mandate,
        qualification facts or sending permission.
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((raw) => {
          const item = record(raw);
          return (
            <li key={text(item.id)}>
              <p>{text(record(item.input).text)}</p>
              <p className="break-all text-[var(--muted)]">
                {text(item.id)} · Version {String(item.revision)}
              </p>
            </li>
          );
        })}
      </ul>
      <ul className="mt-3 space-y-2">
        {entries.flatMap((raw, index) => {
          const entry = record(raw),
            assessment = record(entry.guidanceAssessment);
          return Array.isArray(assessment.explanations)
            ? assessment.explanations.map((value, n) => {
                const explanation = record(value);
                return (
                  <li key={`${index}:${n}`}>
                    <p>
                      {text(entry.name) ||
                        text(entry.contactId) ||
                        text(entry.targetId)}{" "}
                      · {text(explanation.status)}
                    </p>
                    <p>{text(explanation.reason)}</p>
                  </li>
                );
              })
            : [];
        })}
      </ul>
    </details>
  );
}
export function AgentNativeProposalDetails({
  name,
  input,
  mandateId,
  people,
}: {
  people?: AgentChatPersonView[];
  name: string;
  input: Record<string, unknown>;
  mandateId?: string;
}) {
  if (
    ![
      "research.start",
      "research.people",
      "research.fields",
      "target.select",
      "sequence.prepare",
      "sequence.publish",
      "sequence.enrol",
    ].includes(name)
  )
    return null;
  if (!nativeProposalReviewable(name, input))
    return (
      <p role="alert" className="text-sm text-[var(--status-red)]">
        Incomplete proposal. Refresh or reject it; approval is unavailable until
        its exact scope is visible.
      </p>
    );
  if (name === "sequence.prepare") {
    const definition = sequenceDraftForReview(input)!;
    return (
      <div className="space-y-3 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
        <p className="font-semibold">{text(input.name)}</p>
        <p>
          {input.mode === "create"
            ? "New draft"
            : `Update draft revision ${text(input.baseRevision)}`}
        </p>
        <p className="break-all">Sequence {text(input.sequenceId)}</p>
        <p>
          Approval saves this draft only. It does not publish, enrol contacts,
          send messages or book a meeting.
        </p>
        <ol className="space-y-2" aria-label="Main sequence steps">
          {definition.steps.map((step) => (
            <SequenceDraftStep key={step.id} step={step} />
          ))}
        </ol>
        {definition.splits?.map((split) => (
          <section
            key={split.id}
            className="space-y-2 border-t border-[var(--border)] pt-2"
          >
            <p className="font-semibold">{split.title}</p>
            <p className="break-all">
              Split {split.id} · after {split.afterStepId}
            </p>
            {split.condition ? (
              <p>
                LinkedIn acceptance condition · timeout{" "}
                {split.condition.timeoutDays} days
              </p>
            ) : (
              <p>
                Path A: {split.percentage}% · Path B: {100 - split.percentage}%
              </p>
            )}
            {(["pathA", "pathB"] as const).map((path, index) => (
              <div key={path}>
                <p>Path {index === 0 ? "A" : "B"}</p>
                <ol className="space-y-2">
                  {split[path].map((step) => (
                    <SequenceDraftStep key={step.id} step={step} />
                  ))}
                </ol>
              </div>
            ))}
          </section>
        ))}
        {Boolean(definition.disconnectedConnections?.length) && (
          <div>
            <p className="font-semibold">
              Disconnected connections — reconnect in the builder before
              publishing
            </p>
            <ul>
              {definition.disconnectedConnections!.map((edge, index) => (
                <li key={index} className="break-all">
                  {edge.source} → {edge.target}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (name === "sequence.publish")
    return (
      <div className="space-y-2 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
        <p>
          Publish version {String(Number(input.publishedVersion) + 1)} on its
          original {text(input.runtime)} runtime.
        </p>
        <p className="break-all">
          Sequence {text(input.sequenceId)} · frozen version{" "}
          {text(input.versionId)} · draft revision {text(input.draftRevision)}
        </p>
        <p>
          Workflow creation and activation are journalled. Unknown outcomes
          require reconciliation of the original workflow. This never enrols
          contacts or approves an email.
        </p>
      </div>
    );
  if (name === "sequence.enrol")
    return (
      <div className="space-y-2 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
        <p>
          Enrol into exact published version {String(input.version)} on its
          original {text(input.runtime)} runtime.
        </p>
        <p className="break-all">
          Version {text(input.versionId)} · recorded email account{" "}
          {text(input.bindingId)}
        </p>
        <ul>
          {(input.selected as unknown[]).map((item) => {
            const c = record(item);
            return (
              <li key={text(c.contactId)}>
                {text(c.name)} · {text(c.recipient)} ·{" "}
                {c.qualificationConfirmed === true
                  ? "Human-confirmed qualification"
                  : "Qualification remains unconfirmed"}
              </li>
            );
          })}
        </ul>
        <p>
          Every enrolment starts held for first-conversation review. No send,
          automatic resume or account substitution is approved.
        </p>
      </div>
    );
  if (name === "research.fields") {
    const policy = record(input.providerPolicy),
      perCompany = record(policy.perCompany);
    return (
      <div className="space-y-2 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
        <p className="font-semibold">Public company field research</p>
        <ul>
          {(input.selected as unknown[]).map((raw) => {
            const c = record(raw);
            return (
              <li key={text(c.targetId)} className="space-y-1">
                <p>
                  {text(c.name)} · {text(c.domain)}
                </p>
                <p>{(c.fields as string[]).join(", ")}</p>
                {c.verifyAbn === true && (
                  <p>Verify ABN against public identity evidence.</p>
                )}
              </li>
            );
          })}
        </ul>
        <p>
          No personal contacts or phone unlocks. AI is off. Outreach remains
          subject to separate approval.
        </p>
        <p>
          Per company: up to {String(perCompany.search)} physical search
          attempts and {String(perCompany.page)} physical page requests,
          including retries and registry reads.
        </p>
        <p>
          Each physical request reserves up to $1 within current organisation,
          user and mandate budgets. Unknown costs remain reserved. Unavailable
          public facts remain unknown.
        </p>
        <p className="break-all">
          Saved job handle: {text(record(input.config).requestId)}
        </p>
      </div>
    );
  }
  if (name === "research.people") {
    const selected = input.selected as unknown[],
      policy = record(input.providerPolicy);
    return (
      <div className="space-y-2 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
        <p className="font-medium">Email contact enrichment only</p>
        <p>
          Up to {String(input.maxContactsPerCompany)} contacts per selected
          company. Phone enrichment is off. This does not approve outreach.
        </p>
        <ul>
          {selected.map((item) => {
            const company = record(item);
            return (
              <li key={text(company.targetId)}>
                {text(company.name)} · Firmable {text(company.firmableId)}
              </li>
            );
          })}
        </ul>
        <p>
          Physical Firmable attempt ceiling:{" "}
          {String(record(policy.maxAttempts).firmable)}. Conservative
          reservation: up to $1 per physical request within current budgets;
          unknown costs remain reserved.
        </p>
        <p className="break-all">
          Saved job handle: {text(record(input.config).requestId)}
        </p>
      </div>
    );
  }
  if (name === "research.start") {
    const config = record(input.config),
      policy = record(input.providerPolicy),
      attempts = record(policy.maxAttempts),
      discovery = config.companyDiscoveryPolicy
        ? companyDiscoveryPolicySchema.parse(config.companyDiscoveryPolicy)
        : null,
      all = discovery?.version === 4,
      continuation = config.companyContinuation
        ? hybridCompanyContinuationSchema.parse(config.companyContinuation)
        : null;
    if (discovery?.version === 5) {
      const people = discovery.automaticPeople,
        pricing = record(policy.requestCeilingsMicroUsd),
        money = (micro: number) =>
          new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(micro / 1000000),
        companyReserve =
          Number(attempts.search) * Number(pricing.search) +
          Number(attempts.page) * Number(pricing.page),
        totalAttempts = Object.values(attempts).reduce<number>(
          (sum, value) => sum + Number(value),
          0,
        );
      return (
        <div className="space-y-2 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
          <dl className="space-y-2">
            <div>
              <dt className="font-semibold">Workflow</dt>
              <dd>Company research and basic contacts</dd>
            </div>
            <div>
              <dt className="font-semibold">Research scope</dt>
              <dd>{text(config.researchScope)}</dd>
            </div>
            <div>
              <dt className="font-semibold">Geography</dt>
              <dd>{text(config.geography)}</dd>
            </div>
            <div>
              <dt className="font-semibold">Company coverage</dt>
              <dd>
                Up to {discovery.maxFirmablePages} Firmable pages (
                {discovery.maxFirmableRows} rows) and {discovery.maxWebQueries}{" "}
                web queries ({discovery.maxWebRowsPerQuery} rows each). Every
                unique discovered company receives a profile attempt within the
                shared budget and deadline, without a shortlist or source quota.
                The {discovery.maxProfiledCompanies}-identity ceiling follows
                these source bounds; it is not a promise to finish every profile
                or cover every provider match.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Automatic basic contacts</dt>
              <dd>
                Names, roles and available email addresses are fetched
                automatically for up to {people.maxCompanies} matched companies:{" "}
                {people.maxSearchPagesPerCompany} search page of up to{" "}
                {people.searchPageSize} rows and at most{" "}
                {people.maxContactsPerCompany} contacts per matched company.
                Missing email addresses remain unavailable. Company and contact
                results are saved to the Companies and People pages.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Phones</dt>
              <dd>
                Phone enrichment is off. Phone lookups require a separate
                credit-consuming action and approval.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Physical attempt ceilings</dt>
              <dd>
                Firmable: {String(attempts.firmable)} · Search:{" "}
                {String(attempts.search)} · Pages: {String(attempts.page)} · AI:{" "}
                {String(attempts.ai)}. The{" "}
                {totalAttempts.toLocaleString("en-US")}-attempt maximum includes
                company, authentication and People requests; calls are admitted
                one at a time under current limits.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Conservative reservation</dt>
              <dd>
                {money(companyReserve)} is reserved for the company phase.
                Configured company and authentication reads have a{" "}
                {money(Number(policy.firmableCompanyRequestCeilingMicroUsd))}{" "}
                incremental reserve. Basic contact searches and profiles reserve
                up to {money(Number(pricing.firmable))} per physical People
                request from current budgets, rather than reserving the entire
                possible People phase up front. These are reservation ceilings,
                not a quoted provider charge. Raw unknown-cost receipts are
                preserved.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Result meaning</dt>
              <dd>
                Profiles are saved before ranking; acquisition fit still
                requires evidence. Shared budgets and the{" "}
                {String(record(config.budget).maxMinutes)}-minute deadline may
                leave company or contact work incomplete. Missing facts remain
                unknown; conflicting identities remain for review. Background
                field research is off.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Saved job handle</dt>
              <dd className="break-all">{text(config.requestId)}</dd>
            </div>
          </dl>
          <p>
            Approval authorizes this company and basic contact research scope
            only. It does not approve outreach.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2 rounded-lg bg-[var(--panel-raised)] p-3 text-xs">
        <dl className="space-y-2">
          <div>
            <dt className="font-semibold">Workflow</dt>
            <dd>
              {continuation
                ? "Remaining company profiles"
                : record(input.execution).pipeline === "hybrid-company-v1"
                  ? "Hybrid company discovery"
                  : "Firmable company discovery"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Research scope</dt>
            <dd>{text(config.researchScope)}</dd>
          </div>
          <div>
            <dt className="font-semibold">Geography</dt>
            <dd>{text(config.geography)}</dd>
          </div>
          <div>
            <dt className="font-semibold">
              {all ? "Company coverage" : "Target cap"}
            </dt>
            <dd>
              {continuation
                ? `${continuation.candidateKeys.length} remaining company profiles`
                : all
                  ? "All unique companies in the declared discovery scope"
                  : `${String(config.targetBusinesses)} companies`}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">
              {continuation ? "Saved source" : "Discovery sampling"}
            </dt>
            <dd>
              {continuation ? (
                <>
                  <span className="break-all">
                    Source root {continuation.sourceRootId}
                  </span>
                  . No new discovery. Only the reviewed, never-started company
                  profiles from this saved source are included. Approval creates
                  a new research root. Original receipts and holds remain on
                  their original jobs; uncertain or attempted work is not
                  replayed.
                </>
              ) : all ? (
                <>
                  Up to 2 Firmable pages (200 rows) and 6 web queries (100 rows
                  each). Every unique discovered company receives a company-only
                  profile attempt, without a shortlist or source quota. Repeated
                  identities merge; conflicting provider identities remain for
                  review. The 800-identity ceiling follows these source bounds,
                  not a fit ranking. Results do not claim coverage of every
                  provider match beyond those pages.
                </>
              ) : discovery ? (
                <>
                  Up to 100 rows per page, 2 pages (200 rows), then at most 20
                  company profiles. Original AU country scope and exclusions are
                  preserved for pagination; ambiguous scope stops for review. Up
                  to 6 balanced web queries cover subsectors before repeated
                  variants. Numeric search buckets are not exact staff counts.
                  {discovery.version === 3 && (
                    <>
                      {" "}
                      Overlapping provider-labelled AU staff bands are sampled
                      in rotation, starting with the smaller band
                      {discovery.profileSelection.requestedHeadcount
                        ? ` for the requested ${discovery.profileSelection.requestedHeadcount.min}–${discovery.profileSelection.requestedHeadcount.max} staff range`
                        : " only when a staff range is specified"}
                      . Unknown bands remain in the sample. Profiles must still
                      confirm company facts; sampling does not establish fit.
                    </>
                  )}
                </>
              ) : (
                <>
                  Original discovery policy: one Firmable page, original query
                  ordering and the displayed company cap.
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Result meaning</dt>
            <dd>
              {all
                ? "Company profiles are saved before ranking; acquisition fit still requires evidence."
                : "20 source company candidates is a goal, not a guarantee of qualified acquisition targets."}{" "}
              Missing facts remain unknown; exclusions are retained. Each
              physical request still needs its existing budget admission, and a
              provider or budget stop may leave fewer results.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Phase</dt>
            <dd>
              Company research only. People enrichment is off. Phone enrichment
              is off. Background field research is off. This approval does not
              start either.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Physical attempt ceilings</dt>
            <dd>
              Firmable: {String(attempts.firmable)} · Search:{" "}
              {String(attempts.search)} · Pages: {String(attempts.page)} · AI:{" "}
              {String(attempts.ai)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Conservative reservation</dt>
            <dd>
              {all
                ? "Configured company-only Firmable incremental reserve: $0 per request, based on the stated no-credit company reads; this is not an observed invoice price. Search and page requests reserve up to $1 each ($11 total phase ceiling). The 24,035-attempt hard maximum is not reserved up front. Each physical request must fit current call limits; exhausted limits leave saved work incomplete. Raw unknown-cost receipts are preserved."
                : "Up to $1 per physical request, within all current budget limits. This is a reservation ceiling, not a quoted provider price."}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Saved job handle</dt>
            <dd className="break-all">{text(config.requestId)}</dd>
          </div>
        </dl>
        <p>
          {all
            ? "Approval authorizes this research phase only. The worker starts after its monetary reserve and current call headroom are checked. It does not approve outreach."
            : "Approval authorizes this research phase only. The worker starts after its full reserve is allocated. It does not approve outreach."}
        </p>
      </div>
    );
  }
  return <AgentContactSelection input={input} mandateId={mandateId} people={people}/>;
}
