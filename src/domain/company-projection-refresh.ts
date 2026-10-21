import {z} from 'zod';
export const companyProjectionRefreshResultSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('current'),published:z.number().int().nonnegative().max(1000),examined:z.number().int().nonnegative().max(1000)}).strict(),
 z.object({status:z.literal('refresh_needed'),message:z.string().min(1).max(1000)}).strict(),
]);
export type CompanyProjectionRefreshResult=z.infer<typeof companyProjectionRefreshResultSchema>;
