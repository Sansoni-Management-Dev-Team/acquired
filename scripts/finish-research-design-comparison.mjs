import{readFileSync,writeFileSync,existsSync}from'node:fs';import{compareDesigns}from'./research-design-metrics.mjs';
const [a,b,out]=process.argv.slice(2);if(!a||!b||!out)throw Error('Pass A final.json, B final.json, and output path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));for(const deadline=Date.now()+170*60000;!existsSync(a)||!existsSync(b);){if(Date.now()>deadline)throw Error('The pair did not finish within the observation window');await pause(1000);}
const comparison=compareDesigns(JSON.parse(readFileSync(a)),JSON.parse(readFileSync(b)));writeFileSync(out,JSON.stringify(comparison,null,2),{mode:0o600});console.log(JSON.stringify({event:'comparison_saved',path:out,comparable:comparison.comparable,reasons:comparison.reasons,durationRatio:comparison.durationRatio}));
