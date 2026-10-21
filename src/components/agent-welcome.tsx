'use client';
import {useEffect,useState} from 'react';
export function AgentWelcome({description,children,savedData}:{description?:string;savedData?:{companies?:number;people?:number};children:React.ReactNode}){
 const [ready,setReady]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setReady(true),3000);return()=>clearTimeout(timer);},[]);
 const summary=(description??'businesses matching your mandate').replace(/^\s*(?:we\s+(?:are\s+)?(?:seeking|want\s+to\s+(?:buy|acquire))|seeking\s+to\s+acquire|seeking|looking\s+for|explore\s+the\s+acquisition\s+of|(?:find|acquire|buy))\s+/i,'').trim();
 const concise=summary.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0,2).join(' ');
 const short=concise.length>360?concise.slice(0,357).replace(/\s+\S*$/,'')+'…':concise;
 return <section aria-label="Welcome to Acquire" className="space-y-8 py-6 text-sm"><div className="space-y-3"><h2 style={{fontFamily:'inherit'}} className="text-2xl font-medium tracking-tight">Hi, I’m Acquire.</h2><p className="max-w-2xl leading-7">I’m your AI acquisition assistant. I’ll find and research businesses that fit your mandate, identify key owners, and help reach out by email, WhatsApp and LinkedIn to invite them to a call.</p></div>{ready&&<div className="space-y-4" aria-live="polite"><p className="max-w-2xl leading-7">You’re looking for {short.replace(/[.!]$/,'')}{short.endsWith('…')?'':'.'}</p>{savedData&&<p className="text-xs text-[var(--muted)]">Demo · {[savedData.companies!==undefined?`${savedData.companies} saved companies`:null,savedData.people!==undefined?`${savedData.people} people`:null].filter(Boolean).join(' · ')}</p>}<p className="font-medium">Ready to begin?</p>{children}</div>}</section>;
}
