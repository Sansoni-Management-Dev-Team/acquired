/** Balance admitted work across independent objectives and companies.
 * Waiting/durable jobs do not imply provider capacity: admission remains separate.
 */
type Task = { config: { companyDomain?: string; researchTask?: string; researchField?: string } };
const lane = (task: Task) => task.config.researchField || task.config.researchTask || 'website';
export function chooseBalancedTask<T extends Task>(pending: T[], active: Task[]): T | undefined {
 const lanes = new Map<string, number>(), domains = new Map<string, number>();
 for (const task of active) {
  lanes.set(lane(task), (lanes.get(lane(task)) || 0) + 1);
  const domain = task.config.companyDomain || '';
  domains.set(domain, (domains.get(domain) || 0) + 1);
 }
 let selected: T | undefined;
 for (const task of pending) {
  if (!selected || (lanes.get(lane(task)) || 0) < (lanes.get(lane(selected)) || 0)
   || ((lanes.get(lane(task)) || 0) === (lanes.get(lane(selected)) || 0)
    && (domains.get(task.config.companyDomain || '') || 0) < (domains.get(selected.config.companyDomain || '') || 0))) selected = task;
 }
 return selected;
}
