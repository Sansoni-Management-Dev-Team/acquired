import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const untrackedProvenance=z.object({kind:z.literal('untracked_authenticated_outbound'),sourceKey:sha,serviceEventId:z.string().min(1).max(200),originalPayloadDigest:sha,bindingDigest:sha,receivedAt:z.iso.datetime(),noAssociation:z.literal(true)}).strict();
/** The immutable audit is read under a server-held campaign role, never supplied by a client. */
export function reviewWakeAuditCode(metadata:Record<string,unknown>,serviceEventId:string):'identity_pending'|'protocol'|null{
 if(metadata.originalCode==='identity_pending')return 'identity_pending';
 const proof=untrackedProvenance.safeParse(metadata.provenance);
 return metadata.originalCode==='protocol'&&proof.success&&proof.data.serviceEventId===serviceEventId?'protocol':null;
}
