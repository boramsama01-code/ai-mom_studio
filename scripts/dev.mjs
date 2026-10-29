import { execFileSync, spawn } from 'node:child_process';
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {stdio:'inherit'});
const child=spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:{...process.env,NODE_ENV:'development',PORT:process.env.PORT||'4173'}});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??0));
