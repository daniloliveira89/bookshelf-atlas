"""Bookshelf Atlas: shared export/API normalization. No network side effects."""
import re, hashlib
from datetime import datetime

HEADERS = ['Notion ID','Book Title','Author','Country','Published','Genre','Rate','GR','Status','Pages','Category','Read','End Date','Favorite','Cover','Good Reads','Audio / Ebook','Series','Full Title (or Original)','Rate Original']

def items(value):
    if isinstance(value,list): return list(dict.fromkeys(str(x).strip() for x in value if str(x).strip()))
    s=str(value or '').strip()
    if not s: return []
    s=re.sub(r'\s*\(https?://[^)]*\)','',s)
    return list(dict.fromkeys(x.strip() for x in re.split(r'\s*\|\s*|,\s*|;\s*',s) if x.strip()))

def number(value,lo=None,hi=None):
    try: n=float(str(value).strip().replace(',','.'))
    except (ValueError,TypeError): return None
    if not (-float('inf')<n<float('inf')) or lo is not None and n<lo or hi is not None and n>hi: return None
    return int(n) if n.is_integer() else n

def rate(value):
    s=str(value or '')
    if '❤' in s or '♥' in s: return 5
    stars=len(re.findall('[⭐★]',s))
    return stars if 1<=stars<=5 else number(value,1,5)

def date_end(value):
    if not value: return ''
    s=str(value).split('→')[-1].strip()
    try: return datetime.fromisoformat(s.replace('Z','+00:00')).date().isoformat()
    except ValueError: pass
    for fmt in ('%B %d, %Y','%b %d, %Y','%Y-%m-%d'):
        try: return datetime.strptime(s,fmt).date().isoformat()
        except ValueError: pass
    return ''

def scalar(value):
    return ' | '.join(str(x) for x in value) if isinstance(value,list) else str(value or '')

def normalize(raw,record_id=''):
    rawrate=scalar(raw.get('Rate',''))
    end=date_end(scalar(raw.get('End Date','')))
    years=[int(x) for x in items(raw.get('Read')) if re.fullmatch(r'\d{4}',x)]
    # Read is authoritative. End Date is a fallback only if Read has no year.
    if not years and end: years=[int(end[:4])]
    published=number(raw.get('Published'),-10000,9999)
    if published is not None and int(published)!=published: published=None
    status=scalar(raw.get('Status','')).strip()
    title=str(raw.get('Book Title','') or '').strip()
    identity='|'.join(str(raw.get(k,'')) for k in ['Book Title','Author','Published','Full Title (or Original)'])
    return {'id':record_id or 'export-'+hashlib.sha256(identity.encode()).hexdigest()[:20],
        'title':title,'authors':items(raw.get('Author')),'countries':items(raw.get('Country')),
        'published':published,'genres':items(raw.get('Genre')),'rate':rate(rawrate),
        'gr':number(raw.get('GR'),0,5),'status':status,'pages':number(raw.get('Pages'),0),
        'category':scalar(raw.get('Category','')).strip(),'years':years,'endDate':end,
        'favorite':'❤' in rawrate or '♥' in rawrate,
        'cover':str(raw.get('Cover','') or '') if str(raw.get('Cover','')).startswith(('https://','/covers/')) else '',
        'goodreads':str(raw.get('Good Reads','') or ''),'formats':items(raw.get('Audio / Ebook')),
        'series':items(raw.get('Series')),'original':str(raw.get('Full Title (or Original)','') or ''),'rawRate':rawrate}

def sheet_row(b):
    return [b['id'],b['title'],' | '.join(b['authors']),' | '.join(b['countries']),b['published'],
      ' | '.join(b['genres']),b['rate'],b['gr'],b['status'],b['pages'],b['category'],
      ' | '.join(map(str,b['years'])),b['endDate'],'❤' if b['favorite'] else '',b['cover'],b['goodreads'],
      ' | '.join(b['formats']),' | '.join(b['series']),b['original'],b['rawRate']]
