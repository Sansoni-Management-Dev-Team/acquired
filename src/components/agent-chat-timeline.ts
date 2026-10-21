/** Keep the single live inline editor before responses caused by its actions.
 * Message order comes from the saved transcript; this only locates the editor.
 */
export function messagesAroundInlineAction<T extends {id:string}>(messages:readonly T[],visibleBeforeAction:readonly string[]|null):{before:T[];after:T[]}{
 if(visibleBeforeAction===null)return {before:[...messages],after:[]};
 const previousIds=new Set(visibleBeforeAction);
 const lastPreviousIndex=messages.findLastIndex(message=>previousIds.has(message.id));
 return {before:messages.slice(0,lastPreviousIndex+1),after:messages.slice(lastPreviousIndex+1)};
}
