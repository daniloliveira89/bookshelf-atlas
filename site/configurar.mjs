import fs from 'node:fs';import readline from 'node:readline/promises';import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('./wrangler.json',import.meta.url));
const config=JSON.parse(fs.readFileSync(path,'utf8'));
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
try{let input=(await rl.question('Cole o link ou ID da NOVA planilha da biblioteca: ')).trim();
const match=input.match(/\/spreadsheets\/d\/([\w-]+)/);const id=match?match[1]:input;
if(!/^[\w-]{20,}$/.test(id))throw new Error('ID inválido. Use o link da planilha, não o link do Apps Script.');
config.vars.GOOGLE_SHEETS_ID=id;fs.writeFileSync(path,JSON.stringify(config,null,2)+'\n');console.log('ID salvo. Agora execute os comandos de instalação e deploy do tutorial.');
}finally{rl.close();}
