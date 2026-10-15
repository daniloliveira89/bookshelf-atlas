/** Bookshelf Atlas 1.0. Run instalarBiblioteca once in the imported spreadsheet. */
const BIBLIOTECA = {
  fonte: 'Books',
  graficos: [
    ['Read by Year','years','count','COLUMN'],
    ['Pages by Year','years','pages','COLUMN'],
    ['Read by Genre','genres','count','BAR'],
    ['Read by Country','countries','count','BAR'],
    ['By Rating','rate','count','COLUMN'],
    ['By Published Year','published','count','COLUMN'],
    ['Average Rate per Year','published','mean','COLUMN'],
    ['Rate per Decade','decade','mean','COLUMN'],
    ['Rate per Author','authors','mean','BAR'],
    ['Rate per Genre','genres','mean','BAR'],
    ['Rate per Country','countries','mean','BAR'],
    ['You x Goodreads','gr','scatter','SCATTER']
  ]
};
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bookshelf Atlas').addItem('Atualizar gráficos','atualizarBiblioteca').addItem('Instalar atualização automática','instalarBiblioteca').addToUi();
}
function instalarBiblioteca() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss.getSheetByName(BIBLIOTECA.fonte)) throw new Error('Importe Bookshelf-Atlas.xlsx e abra o Apps Script dessa planilha. A aba Books não foi encontrada.');
  PropertiesService.getDocumentProperties().setProperty('bookshelfSpreadsheet',ss.getId());
  atualizarBiblioteca();
  const names=['bibliotecaVerificar','bibliotecaAoEditar'];
  ScriptApp.getProjectTriggers().filter(t=>names.includes(t.getHandlerFunction())).forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('bibliotecaVerificar').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('bibliotecaAoEditar').forSpreadsheet(ss).onEdit().create();
  ss.toast('Gráficos instalados. Alterações via GitHub são detectadas em até aproximadamente 10 minutos.','Bookshelf Atlas',10);
}
function bibliotecaAoEditar(e) { if(e && e.range && e.range.getSheet().getName()===BIBLIOTECA.fonte) bibliotecaVerificar(); }
function atualizarBiblioteca() { bibliotecaAtualizar_(true); }
function bibliotecaVerificar() { bibliotecaAtualizar_(false); }
function bibliotecaResumos_(values) {
  const headers=values[0]||[],idx={};headers.forEach((x,i)=>idx[x]=i);
  ['Book Title','Status','Read','Rate','GR','Author','Genre','Country','Published','Pages'].forEach(k=>{if(idx[k]===undefined)throw new Error('Coluna ausente em Books: '+k);});
  const list=x=>String(x||'').split(/\s*\|\s*/).filter(Boolean);
  const numeric=x=>x===''||x==null?null:Number(x);
  const books=values.slice(1).filter(r=>r[idx['Book Title']] && r[idx.Status]==='Read').map(r=>{
    const n=numeric(r[idx.Rate]),gr=numeric(r[idx.GR]),year=numeric(r[idx.Published]);
    return {years:[...new Set(list(r[idx.Read]).filter(x=>/^\d{4}$/.test(x)))],authors:list(r[idx.Author]),genres:list(r[idx.Genre]),countries:list(r[idx.Country]),
      rate:n>=1&&n<=5?n:null,gr:gr!==null&&gr>=0&&gr<=5?gr:null,published:Number.isInteger(year)?year:null,
      pages:Math.max(0,numeric(r[idx.Pages])||0),title:r[idx['Book Title']]};
  });
  return BIBLIOTECA.graficos.map(([name,key,metric,type])=>{
    if(metric==='scatter')return {name,type,metric,rows:[['Your rating','Goodreads'],...books.filter(b=>b.rate!==null&&b.gr!==null).map(b=>[b.rate,b.gr])]};
    const groups=new Map();
    books.forEach(b=>{
      if(metric==='mean'&&b.rate===null)return;
      let keys=key==='decade'?(b.published!==null?[Math.floor(b.published/10)*10]:[]):Array.isArray(b[key])?b[key]:(b[key]!==null?[b[key]]:[]);
      [...new Set(keys)].forEach(k=>{const g=groups.get(k)||{n:0,total:0};g.n++;g.total+=metric==='pages'?b.pages:metric==='mean'?b.rate:1;groups.set(k,g);});
    });
    const rows=[...groups].filter(([k,g])=>key!=='authors'||g.n>=5).map(([k,g])=>[String(k),metric==='mean'?g.total/g.n:g.total,g.n]);
    rows.sort((a,b)=>['years','published','decade'].includes(key)?Number(a[0])-Number(b[0]):key==='rate'?Number(b[0])-Number(a[0]):b[1]-a[1]||a[0].localeCompare(b[0]));
    return {name,type,metric,rows:[[key,metric==='mean'?'Average rating':metric==='pages'?'Pages':'Books','Books'],...rows]};
  });
}
function bibliotecaAtualizar_(force) {
  const lock=LockService.getDocumentLock();if(!lock.tryLock(1000))return;
  try {
    const props=PropertiesService.getDocumentProperties(),id=props.getProperty('bookshelfSpreadsheet');
    const ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();
    const source=ss.getSheetByName(BIBLIOTECA.fonte);if(!source)throw new Error('Aba Books não encontrada.');
    const values=source.getDataRange().getValues();
    const hash=Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(values)));
    if(!force && props.getProperty('bookshelfHash')===hash)return;
    const summaries=bibliotecaResumos_(values); // Validate everything before modifying charts.
    summaries.forEach(({name,type,metric,rows})=>{
      const sh=ss.getSheetByName(name)||ss.insertSheet(name);
      if(sh.getMaxRows()<rows.length+5)sh.insertRowsAfter(sh.getMaxRows(),rows.length+5-sh.getMaxRows());
      sh.getRange('A1').setValue(name).setFontSize(18).setFontWeight('bold');
      sh.setHiddenGridlines(true).setFrozenRows(1).setColumnWidth(1,840).setColumnWidth(2,28).setColumnWidth(3,220).setColumnWidths(4,2,125).setColumnWidth(6,28).setColumnWidth(7,550);
      sh.getRange(1,3,sh.getMaxRows(),3).clearContent();
      sh.getRange(1,3,rows.length,rows[0].length).setValues(rows.map(r=>r.map(v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v))); 
      sh.getRange(1,3,1,rows[0].length).setBackground('#344C42').setFontColor('#FFFFFF').setFontWeight('bold');
      if(metric==='mean')sh.getRange(2,4,Math.max(rows.length-1,1),1).setNumberFormat('0.00');
      const note=metric==='scatter'?'Somente itens Read com as duas notas. Ambas usam escala 1–5.':name==='Rate per Author'?'Somente itens Read. Mínimo de 5 livros avaliados por autor.':name==='Pages by Year'?'Soma de Pages dos itens Read, agrupados pelo ano em Read.':'Somente itens Read. Categorias e anos novos entram automaticamente.';
      sh.getRange('G1').setValue('Observação').setFontWeight('bold');sh.getRange('G2').setValue(note).setWrap(true);
      sh.getCharts().forEach(c=>sh.removeChart(c));
      if(rows.length>1){
        const chart=sh.newChart().setChartType(Charts.ChartType[type]).addRange(sh.getRange(1,3,rows.length,2)).setNumHeaders(1).setPosition(3,1,0,0)
          .setOption('width',815).setOption('height',type==='BAR'?Math.max(450,Math.min(1500,(rows.length-1)*28+100)):460)
          .setOption('legend',{position:'none'}).setOption('backgroundColor','#FFFFFF').setOption('colors',['#587D68'])
          .setOption('chartArea',{left:type==='BAR'?230:70,top:30,width:type==='BAR'?'63%':'84%',height:'78%'});
        if(type==='BAR')chart.setOption('vAxis',{direction:-1}).setOption('hAxis',{viewWindow:{min:0,...(metric==='mean'?{max:5.2}:{})}});
        else if(type==='SCATTER')chart.setOption('hAxis',{title:'Your rating',viewWindow:{min:0,max:5.3}}).setOption('vAxis',{title:'Goodreads',viewWindow:{min:0,max:5.3}}).setOption('pointSize',5);
        else chart.setOption('vAxis',{viewWindow:{min:0,...(metric==='mean'?{max:5.2}:{})}});
        sh.insertChart(chart.build());
      }
    });
    const update=ss.getSheetByName('Update')||ss.insertSheet('Update');
    update.getRange('A7:B8').setValues([['Charts updated',new Date()],['Chart refresh','10 minutes / manual / edits in Books']]);
    update.getRange('B7').setNumberFormat('dd/MM/yyyy HH:mm:ss');update.setColumnWidth(1,240).setColumnWidth(2,520);
    props.setProperty('bookshelfHash',hash);
  } finally {lock.releaseLock();}
}
