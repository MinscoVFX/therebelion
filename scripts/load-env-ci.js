const fs=require('fs'),path=require('path');
const p=path.resolve(process.cwd(),'.env.ci');
if(!fs.existsSync(p))process.exit(0);
const out=fs.readFileSync(p,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).filter(l=>!l.startsWith('#'));
if(process.env.GITHUB_ENV){fs.appendFileSync(process.env.GITHUB_ENV,out.join('\n')+'\n');}