// Constructor compatibility only; durability and storage are supplied explicitly by server.mjs.
export class WorkflowEntrypoint {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
