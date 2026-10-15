"""Notion -> Google Sheets + public cover cache. Never writes to Notion."""
import io,json,os,re,time,hashlib,sys,ipaddress,socket
from pathlib import Path
from urllib.parse import quote,unquote,urlparse
import requests
from model import normalize,sheet_row,HEADERS

ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'config.json').read_text())
FIELDS=['Book Title','Author','Country','Published','Genre','Rate','GR','Status','Pages','Category','Read','End Date','Cover','Good Reads','Audio / Ebook','Series','Full Title (or Original)']
REQUIRED=['Book Title','Author','Published','Genre','Rate','GR','Status','Pages','Category','Read']

class Notion:
    def __init__(self,token):
        self.session=requests.Session()
        self.session.headers.update({'Authorization':'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'})
        self.titles={};self.last=0
    def call(self,method,path,payload=None):
        for attempt in range(6):
            time.sleep(max(0,.36-(time.monotonic()-self.last)));self.last=time.monotonic()
            try:r=self.session.request(method,'https://api.notion.com/v1/'+path,json=payload,timeout=45)
            except requests.RequestException:
                if attempt==5:raise RuntimeError('Falha de rede ao ler o Notion. Nada foi escrito na planilha.') from None
                time.sleep(min(2**attempt,20));continue
            if r.status_code==429 or r.status_code>=500:
                if attempt<5:time.sleep(min(float(r.headers.get('Retry-After',2**attempt)),30));continue
            if not r.ok:
                raise RuntimeError(f'Notion HTTP {r.status_code} em {path.split("?")[0]}. Verifique a conexão da base e das relações com a integração.')
            return r.json()
        raise RuntimeError('Notion indisponível.')
    def title(self,page_id):
        if page_id not in self.titles:
            p=self.call('GET','pages/'+page_id)
            title=next((x for x in p.get('properties',{}).values() if x.get('type')=='title'),{})
            self.titles[page_id]=''.join(x.get('plain_text',x.get('text',{}).get('content','')) for x in title.get('title',[]))
        return self.titles[page_id]
    def property(self,page_id,p):
        typ=p.get('type');v=p.get(typ)
        if typ in ('title','rich_text'): return ''.join(x.get('plain_text',x.get('text',{}).get('content','')) for x in v or [])
        if typ in ('select','status'):return (v or {}).get('name','')
        if typ=='multi_select':return [x['name'] for x in v or []]
        if typ in ('number','url','email','phone_number','checkbox'):return v if v is not None else ''
        if typ=='date':return (v or {}).get('end') or (v or {}).get('start','')
        if typ=='files':return (v[0].get(v[0].get('type'),{}) or {}).get('url','') if v else ''
        if typ=='relation':
            rel=v or []
            if p.get('has_more'):
                rel=[];cursor=None
                while True:
                    path='pages/'+page_id+'/properties/'+quote(unquote(p['id']),safe='')+'?page_size=100'
                    if cursor:path+='&start_cursor='+quote(cursor,safe='')
                    result=self.call('GET',path)
                    rel.extend(x['relation'] for x in result.get('results',[]) if x.get('type')=='relation')
                    if not result.get('has_more'):break
                    cursor=result['next_cursor']
            return [self.title(x['id']) for x in rel]
        if typ=='formula':return self.property(page_id,v or {})
        if typ=='string':return v or ''
        if typ=='rollup':
            if (v or {}).get('type')=='array':
                parts=[self.property(page_id,x) for x in v.get('array',[])]
                return [z for part in parts for z in (part if isinstance(part,list) else [part]) if z!='']
            return self.property(page_id,v or {})
        if v is None:return ''
        raise RuntimeError(f'Tipo não suportado: {typ}. Corrija o mapeamento antes de sincronizar.')
    def records(self):
        source=CONFIG.get('notion_data_source_id')
        if not source:
            db=self.call('GET','databases/'+CONFIG['notion_database_id'])
            sources=db.get('data_sources',[])
            if len(sources)!=1:raise RuntimeError('A base tem múltiplas fontes. Preencha notion_data_source_id em config.json com a fonte da biblioteca.')
            source=sources[0]['id']
        schema=self.call('GET','data_sources/'+source).get('properties',{})
        missing=[k for k in REQUIRED if k not in schema]
        if missing:raise RuntimeError('Colunas ausentes: '+', '.join(missing))
        checked=set()
        for name in FIELDS:
            p=schema.get(name,{})
            if p.get('type')=='relation':
                rel=p.get('relation',{});rid=rel.get('data_source_id') or rel.get('database_id')
                if rid and rid not in checked:
                    self.call('GET',('data_sources/' if rel.get('data_source_id') else 'databases/')+rid);checked.add(rid)
        pages=[];cursor=None
        while True:
            body={'page_size':100}
            if cursor:body['start_cursor']=cursor
            data=self.call('POST','data_sources/'+source+'/query',body)
            pages.extend(p for p in data['results'] if not p.get('archived') and not p.get('in_trash'))
            if not data.get('has_more'):break
            cursor=data['next_cursor']
        return pages

def checked_image_url(url):
    u=urlparse(url)
    if u.scheme!='https' or not u.hostname or u.username or u.password:raise ValueError('URL de capa inválida')
    for entry in socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(entry[4][0]).is_global:raise ValueError('URL de capa não pública')
    return url

def fetch_image(url):
    # No Notion/Google credentials are attached to image requests.
    for _ in range(4):
        checked_image_url(url)
        with requests.get(url,timeout=25,stream=True,allow_redirects=False) as r:
            if r.is_redirect:
                from urllib.parse import urljoin
                url=urljoin(url,r.headers['Location']);continue
            r.raise_for_status();out=bytearray()
            for chunk in r.iter_content(65536):
                out.extend(chunk)
                if len(out)>15*1024*1024:raise ValueError('Capa acima de 15 MB')
            return bytes(out)
    raise ValueError('Redirecionamentos demais')

def cache_cover(page_id,url,index):
    if not url:return ''
    repo=os.environ.get('GITHUB_REPOSITORY','');branch=os.environ.get('GITHUB_REF_NAME','main')
    if not repo: return url  # local diagnostic; documented as temporary
    fingerprint=hashlib.sha256(url.split('?')[0].encode()).hexdigest()
    old=index.get(page_id,{})
    dest=ROOT/'site/public/covers';dest.mkdir(parents=True,exist_ok=True)
    old_file=old.get('file','')
    if old.get('source')==fingerprint and old_file and (dest/old_file).is_file():filename=old_file
    else:
        try:
            from PIL import Image,ImageOps
            raw=fetch_image(url)
            im=ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGB');im.thumbnail((360,540))
            output=io.BytesIO();im.save(output,format='WEBP',quality=82)
            content=output.getvalue();filename=page_id+'-'+hashlib.sha256(content).hexdigest()[:12]+'.webp'
            (dest/filename).write_bytes(content)
            index[page_id]={'source':fingerprint,'file':filename}
        except Exception as e:
            print(f'Capa indisponível para {page_id}: {type(e).__name__}. Dados do livro preservados.')
            if not old_file:return ''
            filename=old_file
    return f'https://raw.githubusercontent.com/{repo}/{quote(branch,safe="")}/site/public/covers/{filename}'

def cell(v):
    if v is None or v=='':return {}
    return {'userEnteredValue':{'numberValue':v} if isinstance(v,(int,float)) and not isinstance(v,bool) else {'stringValue':str(v)}}

def write_sheets(books,updated):
    from google.oauth2.service_account import Credentials
    from google.auth.transport.requests import AuthorizedSession
    print('Google: lendo JSON da conta de serviço.', flush=True)
    info=json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
    print('Google: carregando credenciais.', flush=True)
    session=AuthorizedSession(Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/spreadsheets']))
    sid=os.environ['GOOGLE_SHEETS_ID'].strip()
    if not re.fullmatch(r'[\w-]+',sid):raise RuntimeError('GOOGLE_SHEETS_ID deve conter somente o ID, não a URL.')
    base='https://sheets.googleapis.com/v4/spreadsheets/'+sid
    def call(method,suffix='',**kwargs):
        for attempt in range(5):
            r=session.request(method,base+suffix,timeout=90,**kwargs)
            if (r.status_code==429 or r.status_code>=500) and attempt<4:time.sleep(2**attempt);continue
            if not r.ok:raise RuntimeError(f'Google Sheets HTTP {r.status_code}. Confira a API Sheets e compartilhe a planilha com client_email da conta de serviço.')
            return r.json()
    print('Google: acessando a planilha.', flush=True)
    data=call('GET',params={'fields':'sheets.properties'})
    props={x['properties']['title']:x['properties'] for x in data['sheets']}
    requests_body=[];used={x['sheetId'] for x in props.values()}
    def tab(name,nrows,ncols):
        if name not in props:
            sheetid=max(used or {0})+1;used.add(sheetid)
            prop={'sheetId':sheetid,'title':name,'gridProperties':{'rowCount':max(nrows,100),'columnCount':max(ncols,20),'frozenRowCount':1}}
            requests_body.append({'addSheet':{'properties':prop}});props[name]=prop
        prop=props[name];sid=prop['sheetId'];grid=prop.get('gridProperties',{})
        requests_body.append({'updateSheetProperties':{'properties':{'sheetId':sid,'gridProperties':{'rowCount':max(nrows,grid.get('rowCount',100)),'columnCount':max(ncols,grid.get('columnCount',20)),'frozenRowCount':1}},'fields':'gridProperties'}})
        return sid
    table=[HEADERS]+[sheet_row(b) for b in books]
    bookid=tab(CONFIG['sheet_name'],len(table),len(HEADERS))
    # One atomic batch replaces data and timestamp. Remaining old rows are cleared.
    requests_body.append({'updateCells':{'range':{'sheetId':bookid,'startRowIndex':0,'startColumnIndex':0,'endColumnIndex':len(HEADERS)},'rows':[{'values':[cell(v) for v in row]} for row in table],'fields':'userEnteredValue'}})
    meta=[['Bookshelf Atlas','Value'],['Last Notion sync',updated],['Records',len(books)],['Read',sum(b['status']=='Read' for b in books)],['Schema',1]]
    mid=tab('Update',len(meta),2)
    requests_body.append({'updateCells':{'range':{'sheetId':mid,'startColumnIndex':0,'endColumnIndex':2},'rows':[{'values':[cell(v) for v in row]} for row in meta],'fields':'userEnteredValue'}})
    print('Google: gravando os livros e a data de atualização.', flush=True)
    call('POST',':batchUpdate',json={'requests':requests_body})

def main():
    from datetime import datetime,timezone
    for key in ['NOTION_TOKEN','GOOGLE_SERVICE_ACCOUNT_JSON','GOOGLE_SHEETS_ID']:
        if not os.environ.get(key):raise RuntimeError('Secret ausente: '+key)
    notion=Notion(os.environ['NOTION_TOKEN'])
    pages=notion.records();print(f'Notion: {len(pages)} registros encontrados.',flush=True)
    if not pages and os.environ.get('ALLOW_EMPTY_SYNC')!='true':raise RuntimeError('Base vazia. Sincronização interrompida para preservar os dados. Use allow_empty somente se esvaziou a base de propósito.')
    ipath=ROOT/'sync/cover-index.json';index=json.loads(ipath.read_text()) if ipath.exists() else {}
    books=[]
    for i,p in enumerate(pages):
        raw={name:notion.property(p['id'],p['properties'][name]) for name in FIELDS if name in p.get('properties',{})}
        if not raw.get('Cover') and p.get('cover'):raw['Cover']=p['cover'].get(p['cover'].get('type'),{}).get('url','')
        if isinstance(raw.get('Published'),list):raw['Published']=raw['Published'][0] if raw['Published'] else ''
        b=normalize(raw,p['id'])
        if CONFIG.get('download_covers'):b['cover']=cache_cover(p['id'],b['cover'],index)
        books.append(b)
        if (i+1)%100==0:print(f'Preparados {i+1}/{len(pages)} livros.',flush=True)
    books.sort(key=lambda b:(b['title'].casefold(),b['id']))
    updated=datetime.now(timezone.utc).isoformat()
    print(f"Preparados {len(books)}/{len(pages)} livros. Iniciando Google Sheets.", flush=True)
    write_sheets(books,updated)
    (ROOT/'site/public/snapshot.json').write_text(json.dumps({'schema':1,'source':'notion','updatedAt':updated,'books':books},ensure_ascii=False,separators=(',',':')))
    ipath.write_text(json.dumps(index,ensure_ascii=False,indent=2))
    print(f'Sincronização concluída: {len(books)} livros. A planilha e a cópia do site foram atualizadas.')

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        # Report locations only: never print local variables or secret values.
        print(f'ERRO: {type(e).__name__}', file=sys.stderr, flush=True)
        if isinstance(e, RuntimeError):
            print(str(e), file=sys.stderr, flush=True)
        for frame in traceback.extract_tb(e.__traceback__):
            print(
                f'Arquivo: {Path(frame.filename).name} | '
                f'Linha: {frame.lineno} | Função: {frame.name}',
                file=sys.stderr, flush=True
            )
        sys.exit(1)
