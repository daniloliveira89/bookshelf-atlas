import {parseCSV,fromSheet} from './public/model.js';
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname!='/api/books')return env.ASSETS.fetch(request);
    if(request.method!=='GET')return new Response('Method not allowed',{status:405});
    const sid=env.GOOGLE_SHEETS_ID;
    if(!sid)return Response.json({code:'NOT_CONFIGURED'},{status:503});
    if(!/^[\w-]+$/.test(sid))return Response.json({code:'BAD_CONFIG'},{status:503});
    const base=`https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:csv&headers=1&sheet=`;
    try {
      const read=async sheet=>{
        const r=await fetch(base+encodeURIComponent(sheet),{signal:AbortSignal.timeout(18000),headers:{Accept:'text/csv'},cache:'no-store'});
        if(!r.ok)throw new Error('sheet');const csv=await r.text();
        if(/^\s*</.test(csv))throw new Error('private');return parseCSV(csv);
      };
      const [table,meta]=await Promise.all([read(env.SHEET_NAME||'Books'),read('Update')]);
      const books=fromSheet(table);
      const expected=meta.find(r=>r[0]==='Records');
      if(expected && Number(expected[1])!==books.length)throw new Error('incomplete');
      return Response.json({schema:1,source:'sheets',books,updatedAt:meta.find(r=>r[0]==='Last Notion sync')?.[1]||null,fetchedAt:new Date().toISOString()}, {headers:{'Cache-Control':'no-store'}});
    } catch {return Response.json({code:'SHEET_UNAVAILABLE'},{status:502,headers:{'Cache-Control':'no-store'}});}
  }
};
