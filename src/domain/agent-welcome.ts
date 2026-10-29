/** The same deterministic copy is shown before Start and saved at admission. */
export function agentWelcomeCopy(description?:string,researchOnly=false){
 const summary=(description??'businesses matching your mandate').replace(/^\s*(?:we\s+(?:are\s+)?(?:seeking|want\s+to\s+(?:buy|acquire))|seeking\s+to\s+acquire|seeking|looking\s+for|explore\s+the\s+acquisition\s+of|(?:find|acquire|buy))\s+/i,'').trim();
 const concise=summary.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0,2).join(' ');
 const short=concise.length>360?concise.slice(0,357).replace(/\s+\S*$/,'')+'…':concise;
 return{greeting:'Hi, I’m Acquire.',introduction:researchOnly?'I’m your AI acquisition assistant. I’ll find and research businesses that fit your mandate and identify key owners. This is a research-only run; no outreach is sent.':'I’m your AI acquisition assistant. I’ll find and research businesses that fit your mandate, identify key owners, and help reach out by email, WhatsApp and LinkedIn to invite them to a call.',brief:`You’re looking for ${short.replace(/[.!]$/,'')}${short.endsWith('…')?'':'.'}`};
}
export function agentWelcomeMessage(description:string,researchOnly=false){
 const copy=agentWelcomeCopy(description,researchOnly);
 return [copy.greeting,copy.introduction,copy.brief].join('\n\n');
}
