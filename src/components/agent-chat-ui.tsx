import {forwardRef,type ComponentPropsWithoutRef,type ReactNode} from 'react';
import {LoaderCircle} from 'lucide-react';
import styles from './agent-chat-ui.module.css';
export type {AgentChatPersonView} from '@/domain/agent-chat-presentation';
export const AgentChatMessage=forwardRef<HTMLDivElement,ComponentPropsWithoutRef<'div'>&{speaker?:string;kind?:'assistant'|'user'}>(function AgentChatMessage({speaker='Acquire',kind='assistant',className='',children,...props},ref){
 return <div {...props} ref={ref} className={`${styles.message} ${kind==='user'?styles.user:''} ${className}`}><p className={styles.speaker}>{speaker}</p>{children}</div>;
});
export function AgentChatSurface({title,label,children,className=''}:{title?:string;label?:string;children:ReactNode;className?:string}){
 return <section aria-label={label} className={`${styles.surface} ${className}`}>{title&&<h2 className={`${styles.heading} mb-3`}>{title}</h2>}{children}</section>;
}
export function AgentChatIdentity({name,company,role}:{name:string;company?:string;role?:string}){
 return <div className="min-w-0"><p className={styles.name}>{name}</p>{(company||role)&&<p className={styles.caption}>{[role,company].filter(Boolean).join(' · ')}</p>}</div>;
}
export function AgentChatDetails({summary,children,open,className=''}:{summary:ReactNode;children:ReactNode;open?:boolean;className?:string}){
 return <details open={open||undefined} className={`${styles.details} ${className}`}><summary>{summary}</summary><div className={styles.detailBody}>{children}</div></details>;
}
export function AgentChatStatus({children,working=false}:{children:ReactNode;working?:boolean}){
 return <div role="status" className={styles.status}>{working&&<LoaderCircle aria-hidden="true" className={`${styles.statusIcon} animate-spin motion-reduce:animate-none`}/>}<div>{children}</div></div>;
}
export function AgentChatActions({children}:{children:ReactNode}){return <div className={styles.actions}>{children}</div>;}
