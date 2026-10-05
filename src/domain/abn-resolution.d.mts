export type IdentityPage={url:string;text:string};
export type AbnRecord={abn:string;entityName:string;active:boolean;names:string[];location:string;quote?:string;sourceUrl:string};
export function visibleHtml(html:string):string;
export function abnAliases(name:string):string[];
export function abnSearchAliases(name:string,website:string,extra?:string[]):string[];
export function parseAbnRecord(html:string,abn:string):AbnRecord;
export function websiteIdentity(pages:IdentityPage[]):{abns:string[];legalNames:string[];ownerNames:string[]};
export function resolveAbnIdentity(input:{name:string;website:string;pages:IdentityPage[];records:AbnRecord[]}):{status:string;abn:string|null;record:AbnRecord|null;evidence:{sourceUrl:string;kind:string;quote:string}[];candidates:{record:AbnRecord;score:number;evidence:unknown[]}[];scope:string;queryName:string};
