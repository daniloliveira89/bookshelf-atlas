export const split=v=>String(v??'').split(/\s*\|\s*/).filter(Boolean);
export function parseCSV(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('Incomplete CSV');
  if(field||row.length){row.push(field);rows.push(row);}
  if(rows[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');
  return rows;
}
const num=(v,min=-Infinity,max=Infinity)=>v!==''&&v!=null&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;
export function fromSheet(rows){
  const head=rows[0]||[];
  for(const k of ['Notion ID','Book Title','Rate','Status','Read','GR'])if(!head.includes(k))throw new Error('Invalid schema');
  const get=(r,k)=>r[head.indexOf(k)]||'';
  const books=rows.slice(1).filter(r=>get(r,'Notion ID')).map(r=>({id:get(r,'Notion ID'),title:get(r,'Book Title'),authors:split(get(r,'Author')),countries:split(get(r,'Country')),published:num(get(r,'Published')),genres:split(get(r,'Genre')),rate:num(get(r,'Rate'),1,5),gr:num(get(r,'GR'),0,5),status:get(r,'Status'),pages:num(get(r,'Pages'),0),category:get(r,'Category'),years:split(get(r,'Read')).filter(x=>/^\d{4}$/.test(x)).map(Number),endDate:get(r,'End Date'),favorite:/[❤♥]/.test(get(r,'Favorite')),cover:get(r,'Cover'),goodreads:get(r,'Good Reads'),formats:split(get(r,'Audio / Ebook')),series:split(get(r,'Series')),original:get(r,'Full Title (or Original)'),rawRate:get(r,'Rate Original')}));
  if(new Set(books.map(b=>b.id)).size!==books.length)throw new Error('Duplicate record IDs');
  return books;
}
export const isRead=b=>b.status==='Read';
export const isUnread=b=>['Watchlist','Next to','Reading'].includes(b.status);
export function filterBooks(books,f={}){return books.filter(b=>
  (!f.category||b.category===f.category)&&(!f.status||(f.status==='unread'?isUnread(b):b.status===f.status))&&
  (!f.author||b.authors.includes(f.author))&&(!f.genre||b.genres.includes(f.genre))&&(!f.country||b.countries.includes(f.country))&&
  (!f.year||b.years.includes(Number(f.year)))&&(!f.published||b.published===Number(f.published))&&
  (!f.decade||b.published!==null&&Math.floor(b.published/10)*10===Number(f.decade))&&
  (!f.rate||b.rate===Number(f.rate))&&(!f.gr||b.gr!==null&&b.gr>=Number(f.gr))&&(!f.format||b.formats.includes(f.format))&&
  (!f.series||b.series.includes(f.series))&&(!f.favorite||b.favorite)&&
  (!f.search||[b.title,b.original,...b.authors].join(' ').toLocaleLowerCase().includes(f.search.toLocaleLowerCase())));}
export function aggregate(books,key,metric='count',minimum=1){
  const groups=new Map();
  for(const b of books){
    if(metric==='mean'&&b.rate===null)continue;
    const value=key==='decade'?(b.published===null?null:Math.floor(b.published/10)*10):b[key];
    for(const k of new Set(Array.isArray(value)?value:value===null||value===''?[]:[value])){
      const g=groups.get(k)||{key:k,count:0,total:0};g.count++;g.total+=metric==='mean'?b.rate:metric==='pages'?(b.pages||0):1;groups.set(k,g);
    }
  }
  return [...groups.values()].filter(g=>g.count>=minimum).map(g=>({...g,value:metric==='mean'?g.total/g.count:g.total}))
    .sort((a,b)=>['years','published','decade'].includes(key)?Number(a.key)-Number(b.key):key==='rate'?Number(b.key)-Number(a.key):b.value-a.value||String(a.key).localeCompare(String(b.key)));
}
export function sample(books,count=3,rng=Math.random){const pool=[...books];for(let i=pool.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}return pool.slice(0,count);}
export function goal(books,category,monthly,date=new Date()){
  const parts=new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric'}).formatToParts(date);
  const year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);
  const scope=books.filter(b=>(!category||b.category===category)&&isRead(b));
  const count=scope.filter(b=>b.years.includes(year)).length;
  return {year,month,count,annual:monthly*12,pace:monthly*month,onTrack:count>=monthly*month,undated:scope.filter(b=>!b.years.length).length};
}
export function parseGoal(value){const n=Number(String(value).trim().replace(',','.'));return Number.isFinite(n)&&n>=0&&n<=1000?n:null;}
export function moveOrder(ids,id,position){const out=ids.filter(x=>x!==id);out.splice(Math.max(0,Math.min(out.length,position-1)),0,id);return out;}
