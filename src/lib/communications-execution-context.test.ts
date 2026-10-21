import{expect,it,vi}from'vitest';vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({load:vi.fn()}));vi.mock('./mandate-execution-context',()=>({loadMandateExecutionContext:f.load}));
import{communicationsExecutionContextLoader}from'./communications-execution-context';
it.each([
 [{kind:'agent',operationId:'op',fence:1,epoch:1},{kind:'agent',operationId:'op'}],
 [{kind:'campaign',attemptId:'attempt',enrolmentId:'enrolment',versionId:'v',stepId:'s',stepIndex:0,runtime:'legacy'},{kind:'campaign',attemptId:'attempt',enrolmentId:'enrolment'}],
 [{kind:'draft',messageId:'message',revision:'rev'},{kind:'draft',messageId:'message'}],
])('loads exact server origin and captured binding actor %j',async(source,origin)=>{f.load.mockReset();const actor={organizationId:'org',userId:'owner'},load=communicationsExecutionContextLoader(actor),tx={query:vi.fn()};actor.organizationId='foreign';await load(tx,source as never);expect(f.load).toHaveBeenCalledWith(tx,{actor:{organizationId:'org',userId:'owner'},origin});});
