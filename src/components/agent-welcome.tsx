'use client';
import {agentWelcomeCopy} from '@/domain/agent-welcome';
export function AgentWelcome({description,children,savedData,researchOnly=false}:{description?:string;savedData?:{companies?:number;people?:number};researchOnly?:boolean;children:React.ReactNode}){
 const copy=agentWelcomeCopy(description,researchOnly);
 return <section aria-label="Welcome to Acquire" className="space-y-8 py-6 text-sm"><div className="space-y-3"><h2 style={{fontFamily:'inherit'}} className="text-2xl font-medium tracking-tight">{copy.greeting}</h2><p className="max-w-2xl leading-7">{copy.introduction}</p></div><div className="space-y-4"><p className="max-w-2xl leading-7">{copy.brief}</p>{savedData&&<p className="text-xs text-[var(--muted)]">Demo · {[savedData.companies!==undefined?`${savedData.companies} saved companies`:null,savedData.people!==undefined?`${savedData.people} people`:null].filter(Boolean).join(' · ')}</p>}<p className="font-medium">Ready to begin?</p>{children}</div></section>;
}
