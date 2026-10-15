import {filterBooks,aggregate,sample,goal,parseGoal,moveOrder,isRead} from './model.js';
import {words} from './i18n.js';
const $=s=>document.querySelector(s),root=$('#app');
const readStore=(k,fallback)=>{try{return JSON.parse(localStorage.getItem('bookshelf-v1-'+k))??fallback;}catch{return fallback;}};
const saveStore=(k,v)=>{try{localStorage.setItem('bookshelf-v1-'+k,JSON.stringify(v));}catch{}};
let lang=readStore('lang','pt'),theme=readStore('theme','dark'),goals=readStore('goals',{}),order=readStore('order',[]);
if(!['pt','en','es'].includes(lang))lang='pt';if(!['dark','light'].includes(theme))theme='dark';
let payload={books:[],source:'export'},tab='overview',category='',filters={},pickFilters={status:'Watchlist'},drawn=[],tableView=false,editing=false,limit=36,message='',busy=false,dragId='';
const t=k=>words[k]?.[['pt','en','es'].indexOf(lang)]??k;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=(n,d=0)=>Number(n).toLocaleString({pt:'pt-BR',en:'en-US',es:'es-ES'}[lang],{maximumFractionDigits:d});
const categories=()=>[...new Set(['Book','Short','HQ/Manga','Poetry',...payload.books.map(b=>b.category).filter(Boolean)])];
const yearLabel=y=>Number(y)<0?`${Math.abs(y)} ${t('bc')}`:String(y);
const safeURL=url=>{try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const stars=n=>n===null?'—':'★'.repeat(Math.round(n));
const labelStatus=s=>s?t(s):t('notSpecified');
const icon=(name)=>({settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m10 2-1 3-3 1-3-1-2 4 2 2v3l-2 2 2 4 3-1 3 1 1 3h4l1-3 3-1 3 1 2-4-2-2v-3l2-2-2-4-3 1-3-1-1-3Z"/>',theme:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>'}[name]);
const iconButton=(name,action)=>`<button class="icon" data-action="${action}" aria-label="${esc(t(name))}" title="${esc(t(name))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon(name)}</svg></button>`;
function flag(country){
 const special={'🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}':'gb-eng','🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}':'gb-sct'};
 return special[country]?`<img src="https://flagcdn.com/${special[country]}.svg" style="width:23px;height:16px;object-fit:cover;vertical-align:middle" alt="${special[country]==='gb-eng'?'England':'Scotland'}">`:esc(country);
}
function cover(b){
 let hue=[...b.title].reduce((s,c)=>s+c.charCodeAt(0),0)%360;
 return `<div class="book-cover" style="--hue:${hue}"><div class="cover-fallback"><span class="fallback-title">${esc(b.title)}</span><span class="fallback-author">${esc(b.authors.join(', '))}</span></div>${safeURL(b.cover)?`<img src="${esc(safeURL(b.cover))}" alt="${esc(b.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</div>`;
}
function linkBook(b,content){const url=safeURL(b.goodreads);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${content}</a>`:content;}
function card(b,index=0){return `<article class="book-card" data-id="${esc(b.id)}" ${editing&&tab==='favorites'?'draggable="true"':''}>${editing&&tab==='favorites'?`<label class="order-field">${t('position')} <input inputmode="numeric" type="number" min="1" max="${favoriteBooks().length}" value="${index+1}" data-order="${esc(b.id)}" aria-label="${esc(t('position')+' '+b.title)}"></label>`:''}${linkBook(b,cover(b))}<h3>${linkBook(b,esc(b.title))}</h3><p class="book-meta">${esc(b.authors.join(', ')||t('notSpecified'))}</p><p class="book-meta">${b.published!==null?esc(yearLabel(b.published)):''}${b.published!==null&&b.pages!==null?' · ':''}${b.pages!==null?nf(b.pages)+' '+t('pageCount').toLocaleLowerCase():''}</p><div class="book-rating"><span class="stars">${stars(b.rate)}</span>${b.favorite?'<span aria-label="Favorite">❤</span>':''}${b.gr!==null?`<span class="gr-badge">GR ${nf(b.gr,2)}</span>`:''}</div></article>`;}
function favoriteBooks(){
 const books=payload.books.filter(b=>b.favorite&&(!category||b.category===category));
 const rank=new Map(order.map((id,i)=>[id,i]));
 return books.sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9)||a.title.localeCompare(b.title));
}
const distinct=(key,numeric=false)=>[...new Set(payload.books.filter(b=>!category||b.category===category).flatMap(b=>Array.isArray(b[key])?b[key]:b[key]===null||b[key]===''?[]:[b[key]]))].sort((a,b)=>numeric?b-a:String(a).localeCompare(String(b)));
function selector(key,label,values,current,custom={}){
 return `<label>${esc(t(label))}<select data-filter="${key}" aria-label="${esc(t(label))}"><option value="">${t('all')}</option>${values.map(v=>`<option value="${esc(v)}" ${String(current)===String(v)?'selected':''}>${esc(custom[v]??(['status','category'].includes(key)?labelStatus(v):key==='rate'?stars(Number(v)):key==='published'||key==='decade'?yearLabel(v):v))}</option>`).join('')}</select></label>`;
}
function filterPanel(mode='normal'){
 const f=mode==='pick'?pickFilters:filters;
 let fields= mode==='pick'?selector('status','status',['Watchlist','Next to','Reading','Read'],f.status):'';
 fields+=selector('genre','genre',distinct('genres'),f.genre)+selector('author','author',distinct('authors'),f.author)+selector('country','country',distinct('countries'),f.country)+selector('rate','rating',[5,4,3,2,1],f.rate);
 if(mode==='normal')fields+=selector('year','year',distinct('years',true),f.year);
 if(mode==='collection')fields+=selector('status','status',distinct('status'),f.status);
 if(mode==='pick'||mode==='collection')fields+=selector('published','published',distinct('published',true),f.published)+selector('decade','decade',[...new Set(distinct('published',true).map(y=>Math.floor(y/10)*10))],f.decade)+selector('format','format',distinct('formats'),f.format)+selector('series','series',distinct('series'),f.series)+selector('gr','gr',[1,2,3,3.5,4,4.5],f.gr,Object.fromEntries([1,2,3,3.5,4,4.5].map(n=>[n,'≥ '+nf(n,1)])));
 return `<div class="filters">${mode==='collection'?`<label class="search">${t('search')}<input data-search aria-label="${esc(t('search'))}" value="${esc(f.search||'')}" placeholder="${esc(t('search'))}"></label>`:''}${fields}<button data-action="reset">${t('reset')}</button></div>`;
}
function tooltipText(g,mean=false){return `${g.key}: ${nf(g.value,mean?2:0)}${mean?' / 5\n'+g.count+' '+t('books'):''}`;}
function bars(data,mean=false,country=false){
 if(!data.length)return `<div class="empty">${t('noData')}</div>`;
 const max=mean?5:Math.max(...data.map(d=>d.value),1);
 return `<div class="bar-list">${data.map(g=>`<div class="bar-row" tabindex="0" data-tip="${esc(tooltipText(g,mean))}"><span class="bar-name">${country?flag(g.key):esc(g.key)}</span><div class="bar-track"><span style="width:${g.value/max*100}%"></span></div><strong>${nf(g.value,mean?2:0)}</strong></div>`).join('')}</div>`;
}
function columns(data,mean=false){
 if(!data.length)return `<div class="empty">${t('noData')}</div>`;
 const w=700,h=270,left=42,right=16,top=22,bottom=40,plot=h-top-bottom,max=mean?5:Math.max(...data.map(d=>d.value),1),step=(w-left-right)/data.length,bw=Math.max(.8,step*.65),interval=Math.max(1,Math.ceil(data.length/10));
 let svg='';for(let i=0;i<=4;i++){const y=top+plot-i*plot/4;svg+=`<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}"/><text x="${left-8}" y="${y+4}" text-anchor="end">${nf(max*i/4,mean?1:max<8?1:0)}</text>`;}
 svg+=data.map((g,i)=>{const bh=g.value/max*plot,x=left+i*step+(step-bw)/2;return `<rect tabindex="0" class="bar" x="${x}" y="${top+plot-bh}" width="${bw}" height="${Math.max(.5,bh)}" data-tip="${esc(tooltipText(g,mean))}"/>${i%interval===0||i===data.length-1?`<text x="${x+bw/2}" y="${h-13}" text-anchor="middle">${esc(g.key)}</text>`:''}`;}).join('');
 return `<svg class="svg-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t('overview')}">${svg}</svg>`;
}
function panel(title,content,wide=false,note=''){return `<section class="chart-panel ${wide?'wide':''}"><h2>${t(title)}</h2>${content}${note?`<p class="caption">${esc(note)}</p>`:''}</section>`;}
function overview(){
 const rows=filterBooks(payload.books,{...filters,category}).filter(isRead);
 return `${filterPanel()}<div class="charts">${panel('readYear',columns(aggregate(rows,'years')),true)}${panel('pagesYear',columns(aggregate(rows,'years','pages')),true)}${panel('pubYears',columns(aggregate(rows,'published')),true)}${panel('genres',bars(aggregate(rows,'genres')))}${panel('countries',bars(aggregate(rows,'countries'),false,true))}${panel('avgYear',columns(aggregate(rows,'published','mean')),true)}${panel('decades',columns(aggregate(rows,'decade','mean')),true)}${panel('authors',bars(aggregate(rows,'authors','mean',5),true),false,t('minimum5'))}${panel('ratings',columns(aggregate(rows,'rate')))}${panel('avgGenre',bars(aggregate(rows,'genres','mean'),true))}${panel('avgCountry',bars(aggregate(rows,'countries','mean'),true,true))}</div><p class="scope-note">${t('readScope')}</p>`;
}
function table(books){return `<div class="table-wrap"><table><thead><tr>${['bookTitle','author','published','rating','GR','status','pageCount','endDate'].map(k=>`<th>${t(k)}</th>`).join('')}</tr></thead><tbody>${books.map(b=>`<tr><td>${linkBook(b,esc(b.title))}</td><td>${esc(b.authors.join(', '))}</td><td>${b.published===null?'—':esc(yearLabel(b.published))}</td><td><span class="stars">${stars(b.rate)}</span>${b.favorite?' ❤':''}</td><td>${b.gr===null?'—':nf(b.gr,2)}</td><td>${esc(labelStatus(b.status))}</td><td>${b.pages===null?'—':nf(b.pages)}</td><td>${formatDate(b.endDate)}</td></tr>`).join('')}</tbody></table></div>`;}
function collection(){
 const favorite=tab==='favorites',reading=tab==='reading';
 const books=favorite?favoriteBooks():filterBooks(payload.books,{...filters,category,...(reading?{status:'Reading'}:{})});
 return `${favorite?'':filterPanel(reading?'normal':'collection')}<div class="section-head"><div class="muted">${nf(books.length)} ${t('results')}</div><div class="toolbar"><button data-action="view">${t(tableView?'viewCovers':'viewTable')}</button>${favorite&&!tableView?`<button data-action="edit">${t(editing?'done':'edit')}</button>`:''}</div></div>${favorite&&editing?`<p class="scope-note">${t('orderHint')}</p>`:''}${books.length?(tableView?table(books.slice(0,limit)):`<div class="book-grid">${books.slice(0,limit).map(card).join('')}</div>`):`<div class="empty">${t(favorite?'noFavorites':'empty')}</div>`}${books.length>limit?`<button class="more" data-action="more">${t('showMore')}</button>`:''}`;
}
function comparison(){
 const books=filterBooks(payload.books,{...filters,category}).filter(b=>isRead(b)&&b.rate!==null&&b.gr!==null);
 const w=900,h=360,L=55,T=20,R=25,B=45,domain=5.3,x=v=>L+v/domain*(w-L-R),y=v=>h-B-v/domain*(h-T-B);
 let svg='';for(let i=0;i<=5;i++)svg+=`<line x1="${L}" y1="${y(i)}" x2="${w-R}" y2="${y(i)}"/><text x="${L-14}" y="${y(i)+4}" text-anchor="end">${i}</text><text x="${x(i)}" y="${h-15}" text-anchor="middle">${i}</text>`;
 svg+=`<line x1="${x(0)}" y1="${y(0)}" x2="${x(5)}" y2="${y(5)}" stroke-dasharray="5 6" style="stroke:var(--accent);opacity:.6"/>`;
 svg+=books.map(b=>`<circle class="point" tabindex="0" cx="${x(b.rate)}" cy="${y(b.gr)}" r="5" data-tip="${esc(t('rating')+': '+nf(b.rate,1)+'\nGoodreads: '+nf(b.gr,2))}"/>`).join('');
 return `${filterPanel()}${panel('compareTitle',`<svg class="svg-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t('compareTitle'))}">${svg}<text x="${w/2}" y="${h}" text-anchor="middle">${t('rating')}</text><text x="12" y="15">GR</text></svg>`,true,t('compareNote'))}<div class="comparison-cards">${[5,4,3,2,1].map(n=>{const a=books.filter(b=>b.rate===n),avg=a.length?a.reduce((s,b)=>s+b.gr,0)/a.length:null;return `<div class="comparison-card"><span class="stars">${stars(n)}</span><strong>${avg===null?'—':nf(avg,2)}</strong><small>Goodreads · ${a.length} ${t('books')}</small></div>`;}).join('')}</div>`;
}
function pick(){const eligible=filterBooks(payload.books,{...pickFilters,category});const chosen=drawn.map(id=>eligible.find(b=>b.id===id)).filter(Boolean);
 return `<div class="pick-intro"><h2>${t('pickTitle')}</h2><p>${t('pickSub')}</p></div>${filterPanel('pick')}<div class="pick-action"><button class="primary" data-action="draw">${t('draw')}</button><span>${nf(eligible.length)} ${t('eligible')}</span></div>${chosen.length?`<div class="pick-grid">${chosen.map(card).join('')}</div>`:`<div class="empty">${t(eligible.length?'pickFirst':'empty')}</div>`}`;
}
function formatDate(date){if(!date)return '—';const v=new Date(date.length===10?date+'T12:00:00Z':date);return Number.isNaN(v.getTime())?'—':v.toLocaleDateString({pt:'pt-BR',en:'en-US',es:'es-ES'}[lang],{timeZone:'America/Sao_Paulo'});}
function goalWidget(){
 const cats=category?[category]:categories(),year=goal([],null,0).year;
 return `<div class="goals"><div class="goal-heading"><b>${t('goals')}</b>${year}</div><div class="goal-list">${cats.map(c=>{
 const m=parseGoal(goals[c]??0)??0,g=goal(payload.books,c,m);
 return `<div class="goal-item" title="${esc(t('filterScope'))}"><label>${esc(t(c))}</label><strong class="${m>0?(g.onTrack?'good':'bad'):''}">${g.count}</strong><small> / ${m>0?nf(g.annual,1):'—'}</small>${m>0?`<small style="display:block">${nf(g.pace,1)} ${t('pace')}</small><div class="track"><span style="width:${Math.min(100,g.count/g.annual*100)}%"></span></div>`:''}</div>`;}).join('')}</div><button data-action="settings" class="icon" aria-label="${t('setGoal')}">+</button></div>`;
}
function render(){
 document.documentElement.dataset.theme=theme;document.documentElement.lang={pt:'pt-BR',en:'en',es:'es'}[lang];
 const books=payload.books.filter(b=>!category||b.category===category),read=books.filter(isRead),rated=read.filter(b=>b.rate!==null),heroBooks=[...books.filter(b=>b.favorite),...books.filter(b=>!b.favorite)].slice(0,3);
 const cats=categories(),stats=[[t('catalog'),nf(books.length)],[t('completed'),nf(read.length)],[t('pages'),nf(read.reduce((s,b)=>s+(b.pages||0),0))],[t('average'),rated.length?nf(rated.reduce((s,b)=>s+b.rate,0)/rated.length,2):'—']];
 root.innerHTML=`<div class="shell"><header class="top"><a class="brand" href="#" data-action="home"><img src="/favicon.svg" alt="">Bookshelf <i>Atlas</i></a><div class="top-actions"><select data-language aria-label="${t('language')}">${['pt','en','es'].map(l=>`<option value="${l}" ${lang===l?'selected':''}>${l.toUpperCase()}</option>`).join('')}</select>${iconButton('theme','theme')}${iconButton('settings','settings')}${iconButton('refresh','refresh')}</div></header><section class="hero"><div><div class="eyebrow">${esc(category?t(category):t('tagline'))}</div><h1>${t('hero')}</h1><p>${t('sub')}</p></div><div class="hero-art" aria-hidden="true">${heroBooks.map(cover).join('')}</div></section><nav class="category-nav" aria-label="${t('allCategories')}"><button data-category="" class="${!category?'active':''}">${t('allCategories')}</button>${cats.map(c=>`<button data-category="${esc(c)}" class="${category===c?'active':''}">${esc(t(c))}</button>`).join('')}</nav><section class="stats">${stats.map(([l,v])=>`<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join('')}</section>${goalWidget()}<nav class="tabs" aria-label="Navigation">${['overview','collection','reading','favorites','comparison','pick'].map(k=>`<button data-tab="${k}" class="${tab===k?'active':''}" aria-current="${tab===k?'page':'false'}">${t(k)}</button>`).join('')}</nav><main id="main">${tab==='overview'?overview():tab==='comparison'?comparison():tab==='pick'?pick():collection()}</main>${message?`<div class="notice" role="status">${t(message)}</div>`:''}<footer class="footer"><div>Bookshelf Atlas · 1.0<p>${t(payload.source==='export'?'snapshot':'synced')}: ${formatDate(payload.updatedAt)}${payload.source!=='export'&&payload.updatedAt?' · '+new Date(payload.updatedAt).toLocaleTimeString(lang,{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}):''}</p><p>${t('refreshNote')}</p></div><div>${payload.source==='export'?`<p>${t('initialCovers')}</p>`:''}<button data-action="refresh" ${busy?'disabled':''}>${t(busy?'updating':'refresh')}</button></div></footer></div><dialog id="settings"><form id="settings-form"><h2>${t('settings')}</h2><p>${t('goalHelp')}</p><div class="settings-grid">${cats.map((c,i)=>`<label>${esc(t(c))} · ${t('monthly')}<input type="text" inputmode="decimal" data-goal="${esc(c)}" value="${esc(String(goals[c]??0).replace('.',lang==='en'?'.':','))}" aria-label="${esc(t(c)+' '+t('monthly'))}"></label>`).join('')}</div><p>${t('local')}</p>${goal(payload.books,category,0).undated?`<p>${goal(payload.books,category,0).undated} ${t('undated')}</p>`:''}<div class="settings-error" role="alert"></div><div class="buttons"><button type="button" data-action="close">${t('close')}</button><button class="primary" type="submit">${t('save')}</button></div></form></dialog>`;
 root.querySelectorAll('.book-cover img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
 $('#settings-form').addEventListener('submit',e=>{e.preventDefault();const entries=[...root.querySelectorAll('[data-goal]')].map(el=>[el.dataset.goal,parseGoal(el.value)]);if(entries.some(([,v])=>v===null)){$('.settings-error').textContent=t('invalidGoal');return;}goals=Object.fromEntries(entries);saveStore('goals',goals);$('#settings').close();renderStable();});
}
function renderStable(){const x=scrollX,y=scrollY;$('#tooltip').hidden=true;render();requestAnimationFrame(()=>scrollTo(x,y));}
root.addEventListener('click',e=>{
 const categoryButton=e.target.closest('[data-category]');if(categoryButton){category=categoryButton.dataset.category;filters={};pickFilters={status:'Watchlist'};drawn=[];limit=36;editing=false;renderStable();return;}
 const tabButton=e.target.closest('[data-tab]');if(tabButton){tab=tabButton.dataset.tab;filters={};limit=36;editing=false;renderStable();return;}
 const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;e.preventDefault();
 if(action==='theme'){theme=theme==='dark'?'light':'dark';saveStore('theme',theme);renderStable();}
 if(action==='settings')$('#settings').showModal();
 if(action==='close')$('#settings').close();
 if(action==='refresh')refresh();
 if(action==='view'){tableView=!tableView;editing=false;renderStable();}
 if(action==='edit'){editing=!editing;renderStable();}
 if(action==='more'){limit+=36;renderStable();}
 if(action==='reset'){if(tab==='pick')pickFilters={status:'Watchlist'};else filters={};drawn=[];limit=36;renderStable();}
 if(action==='draw'){drawn=sample(filterBooks(payload.books,{...pickFilters,category})).map(b=>b.id);renderStable();}
 if(action==='home'){tab='overview';category='';filters={};render();scrollTo(0,0);}
});
function reorder(id,pos){const all=payload.books.filter(b=>b.favorite);const prev=new Map(order.map((id,i)=>[id,i]));const ids=all.sort((a,b)=>(prev.get(a.id)??1e9)-(prev.get(b.id)??1e9)||a.title.localeCompare(b.title)).map(b=>b.id);const visible=favoriteBooks().map(b=>b.id);const moved=moveOrder(visible,id,pos);let j=0;order=ids.map(x=>visible.includes(x)?moved[j++]:x);saveStore('order',order);renderStable();}
root.addEventListener('change',e=>{
 if(e.target.matches('[data-language]')){lang=e.target.value;saveStore('lang',lang);renderStable();}
 if(e.target.matches('[data-filter]')){(tab==='pick'?pickFilters:filters)[e.target.dataset.filter]=e.target.value;drawn=[];limit=36;renderStable();}
 if(e.target.matches('[data-order]')){const pos=Number(e.target.value);if(Number.isFinite(pos))reorder(e.target.dataset.order,Math.round(pos));}
});
let searchTimer;root.addEventListener('input',e=>{if(e.target.matches('[data-search]')){clearTimeout(searchTimer);const text=e.target.value,pos=e.target.selectionStart;searchTimer=setTimeout(()=>{filters.search=text;limit=36;renderStable();const input=$('[data-search]');input?.focus({preventScroll:true});input?.setSelectionRange(pos,pos);},200);}});
root.addEventListener('dragstart',e=>{const c=e.target.closest('[draggable=true]');if(!c)return;dragId=c.dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId);c.classList.add('dragging');});
root.addEventListener('dragover',e=>{const c=e.target.closest('[draggable=true]');if(!c||!dragId)return;e.preventDefault();root.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));c.classList.add('drop-target');});
root.addEventListener('drop',e=>{const c=e.target.closest('[draggable=true]');if(!c||!dragId)return;e.preventDefault();const index=favoriteBooks().findIndex(b=>b.id===c.dataset.id);reorder(dragId,index+1);dragId='';});
root.addEventListener('dragend',()=>{dragId='';root.querySelectorAll('.dragging,.drop-target').forEach(x=>x.classList.remove('dragging','drop-target'));});
const tip=$('#tooltip');
function showTip(el,x,y){tip.textContent=el.dataset.tip;tip.hidden=false;tip.style.left=Math.min(innerWidth-tip.offsetWidth-12,Math.max(8,x+14))+'px';tip.style.top=Math.min(innerHeight-tip.offsetHeight-12,Math.max(8,y+16))+'px';}
document.addEventListener('pointermove',e=>{const el=e.target.closest('[data-tip]');if(el)showTip(el,e.clientX,e.clientY);else tip.hidden=true;});
document.addEventListener('focusin',e=>{const el=e.target.closest('[data-tip]');if(el){const r=el.getBoundingClientRect();showTip(el,r.x,r.y);}else tip.hidden=true;});
window.addEventListener('scroll',()=>{tip.hidden=true;},{passive:true});
function validData(data){return data?.schema===1&&Array.isArray(data.books)&&data.books.every(b=>b&&typeof b.id==='string'&&typeof b.title==='string'&&['authors','countries','genres','years','formats','series'].every(k=>Array.isArray(b[k])));}
async function refresh(){
 if(busy)return;busy=true;renderStable();
 try{const res=await fetch('/api/books',{cache:'no-store',signal:AbortSignal.timeout(22000)});const data=await res.json();if(!res.ok){message=data.code==='NOT_CONFIGURED'?'notConfigured':'offline';return;}
  if(!validData(data)||payload.source!=='export'&&payload.updatedAt&&data.updatedAt&&new Date(data.updatedAt)<new Date(payload.updatedAt))throw new Error('Invalid or old data');
  payload=data;saveStore('data',data);message='';drawn=[];
 }catch{message='offline';}finally{busy=false;renderStable();}
}
try{
 const snapshot=await fetch('/snapshot.json').then(r=>r.json());if(!validData(snapshot))throw new Error('Invalid snapshot');
 const cached=readStore('data',null);payload=validData(cached)&&new Date(cached.updatedAt)>=new Date(snapshot.updatedAt)?cached:snapshot;
 render();await refresh();
}catch{root.innerHTML=`<div class="initial">Bookshelf <i>Atlas</i><p style="font:16px system-ui">${t('offline')}</p><button onclick="location.reload()">${t('refresh')}</button></div>`;}
