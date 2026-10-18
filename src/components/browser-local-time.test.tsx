import React from 'react';
import{renderToStaticMarkup}from'react-dom/server';
import{it,expect,vi}from'vitest';
import{BrowserLocalTime}from'./browser-local-time';
const value='2026-10-18T00:21:00.000Z';
it('server output preserves the instant without using the server-local timezone',()=>{
 const format=vi.spyOn(Date.prototype,'toLocaleString').mockReturnValue('server UTC timestamp');
 try{const html=renderToStaticMarkup(<BrowserLocalTime value={value}/>);expect(html).toContain('dateTime="'+value+'"');expect(html).toContain('>—</time>');expect(format).not.toHaveBeenCalled();}finally{format.mockRestore();}
});
it('mounted client formats the saved instant in browser-local time without fixing an organization timezone',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const format=vi.spyOn(Date.prototype,'toLocaleString').mockReturnValue('18 Oct 2026, 8:21 am');const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<BrowserLocalTime value={value}/>);});expect(tree!.root.findByType('time').children).toEqual(['18 Oct 2026, 8:21 am']);expect(format).toHaveBeenCalledWith('en-AU',{dateStyle:'medium',timeStyle:'short'});}finally{if(tree)await act(async()=>tree!.unmount());format.mockRestore();vi.unstubAllGlobals();}
});
it('missing instants remain an em dash',()=>{expect(renderToStaticMarkup(<BrowserLocalTime value={null}/>)).toBe('—');});
