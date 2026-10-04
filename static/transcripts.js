/* ==== KEYWORDS ==== */
const keywordsRed = ["commercial fire","cover fire","flue fire","structure fire","urgent","smoke","accident","grass fire","burn","vehicle fire","mva","nva ","mba ","explosion","gunshot"].map(s=>s.toLowerCase());
const keywordsYellow = ["medical aid","mutual aid","flood","power outage","road closure","water rescue"].map(s=>s.toLowerCase());
const keywordsOrange = ["fire alarm","fire investigation"].map(s=>s.toLowerCase());

/* ==== FEED CONFIG (set per page on the script tag: data-feed, data-limit) ==== */
const FEED_CONFIG = document.currentScript.dataset;
const FEED = FEED_CONFIG.feed;                 // archive folder name, e.g. "fire" or "dfpaprimary"
const LIMIT = Number(FEED_CONFIG.limit) || 50; // how many transmissions to show

// Channel tabs shown in the header; dir is the page folder on this site
const FEEDS = [
  {dir:'law1',          label:'Law 1'},
  {dir:'law2',          label:'Law 2'},
  {dir:'fire_dispatch', label:'Fire Dispatch'},
  {dir:'fire2',         label:'Fire 2'},
  {dir:'dfpa_primary',  label:'DFPA'},
];

/* ==== POLLING CONTROL ==== */
const POLL_MS = 15000; // 15 seconds
let inFlight = false;
let aborter = null;
let lastRenderedIds = "";
let renderedIds = null;      // ids currently on screen; null until the first render so the initial load isn't flagged as new
let lastPollOk = false;      // did the last poll reach the archive at all
const itemCache = new Map(); // filename -> rendered item, so unchanged files aren't re-fetched/re-parsed every poll

let pollTimer = null;

// One shared formatter instead of building a new one for every transcript
const timeFmt = new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Los_Angeles',
  year:'numeric',
  month:'2-digit',
  day:'2-digit',
  hour:'2-digit',
  minute:'2-digit',
  second:'2-digit',
  hour12:false
});

// Stop polling entirely while the tab is hidden; resume immediately when it's visible again
document.addEventListener('visibilitychange', () => {
  clearTimeout(pollTimer);
  pollTimer = null;
  if(!document.hidden) runPoll();
});

/* ==== HELPERS ==== */
function escHtml(s){
  return s.replace(/[&<>"']/g,c=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

function highlightText(text){
  const sets=[
    {list:keywordsRed,cls:'keyword-red'},
    {list:keywordsYellow,cls:'keyword-yellow'},
    {list:keywordsOrange,cls:'keyword-orange'}
  ];
  let html=escHtml(text);
  for(const {list,cls} of sets){
    for(const kw of list){
      const t=kw.trim(); if(!t) continue;
      const re=new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');
      html=html.replace(re,`<span class="${cls}">$1</span>`);
    }
  }
  return html;
}

function parseDateFromFilename(fn){
  try{
    const p=fn.replace('.json','').split('_');
    if(p.length<3) return null;
    return new Date(Date.UTC(
      +p[1].slice(0,4),
      +p[1].slice(4,6)-1,
      +p[1].slice(6,8),
      +p[2].slice(0,2),
      +p[2].slice(2,4),
      +p[2].slice(4,6)
    ));
  }catch{
    return null;
  }
}

function getDateUrls(){
  const now=new Date();
  const y=now.getUTCFullYear(),m=now.getUTCMonth()+1,d=now.getUTCDate();
  const yst=new Date(now.getTime()-86400000);
  const yy=yst.getUTCFullYear(),ym=yst.getUTCMonth()+1,yd=yst.getUTCDate();
  return [
    `https://archive.theroseburgreceiver.com/${FEED}/${y}/${m}/${d}/`,
    `https://archive.theroseburgreceiver.com/${FEED}/${yy}/${ym}/${yd}/`,
  ];
}

async function fetchDirectoryFiles(baseUrl,signal){
  const r=await fetch(baseUrl,{signal});
  lastPollOk=true; // a 404 still means the archive answered (e.g. no folder yet for a quiet channel's day)
  if(!r.ok) return [];
  const text=await r.text();
  const doc=new DOMParser().parseFromString(text,'text/html');
  return Array.from(doc.querySelectorAll('a'))
    .map(a=>a.getAttribute('href'))
    .filter(h=>h&&h.endsWith('.json'))
    .map(filename=>({url:baseUrl+filename,filename}));
}

/* ==== MAIN FETCH LOOP (overlap-safe, batched) ==== */
async function fetchTranscriptsOnce(){
  if(inFlight) return;
  inFlight=true;
  if(aborter){try{aborter.abort();}catch{}}
  aborter=new AbortController();
  const {signal}=aborter;

  lastPollOk=false;
  try{
    const [todayUrl,yesterdayUrl]=getDateUrls();
    const newestFirst=list=>list
      .filter(f=>parseDateFromFilename(f.filename))
      .sort((a,b)=>parseDateFromFilename(b.filename)-parseDateFromFilename(a.filename));
    let files=newestFirst(await fetchDirectoryFiles(todayUrl,signal).catch(()=>[]));
    // Yesterday's listing is large; only fetch it when today can't fill the feed on its own
    if(files.length<LIMIT){
      files=files.concat(newestFirst(await fetchDirectoryFiles(yesterdayUrl,signal).catch(()=>[])));
    }
    files=files.slice(0,LIMIT);

    const idKey=files.map(f=>f.filename).join(',');
    if(idKey===lastRenderedIds) return;

    const toFetch=files.filter(f=>!itemCache.has(f.filename));
    const limit=6;
    let i=0;

    async function worker(){
      while(i<toFetch.length){
        const idx=i++;
        const f=toFetch[idx];
        try{
          const r=await fetch(f.url,{signal});
          if(!r.ok) continue;
          const json=await r.json();
          const rawVal=json?.transcript?.transcript;
          const raw=(typeof rawVal==='string' && rawVal.trim()) ? rawVal : 'No transcript available';
          const noAudio=/Thanks\s*for\s*watching|Thank\s*you\s*for\s*watching/gi.test(raw);
          const safe=noAudio ? '-- FIRE TONE OR NO AUDIO --' : raw;

          const dateStr=f.filename.split('_')[1];
          const timeStr=f.filename.split('_')[2].slice(0,6);
          const utc=new Date(Date.UTC(
            +dateStr.slice(0,4),
            +dateStr.slice(4,6)-1,
            +dateStr.slice(6,8),
            +timeStr.slice(0,2),
            +timeStr.slice(2,4),
            +timeStr.slice(4,6)
          ));

          const local=timeFmt.format(utc);

          const baseUrl=f.url.substring(0,f.url.lastIndexOf('/')+1);
          const mp3Link=`${baseUrl}${f.filename.replace('.json','.mp3')}`;

          const low=safe.toLowerCase();
          const matchRed=keywordsRed.find(k=>low.includes(k));
          const matchYel=keywordsYellow.find(k=>low.includes(k));
          const matchOrg=keywordsOrange.find(k=>low.includes(k));

          itemCache.set(f.filename,{
            id:f.filename,
            time:local,
            transcriptHtml:highlightText(safe),
            mp3Link,
            color:matchRed?'red':matchYel?'yellow':matchOrg?'orange':'',
            noise:noAudio
          });
        }catch{
          // ignore per-file errors
        }
      }
    }

    await Promise.all(Array.from({length:limit},worker));

    const currentKeys=new Set(files.map(f=>f.filename));
    for(const key of itemCache.keys()){
      if(!currentKeys.has(key)) itemCache.delete(key);
    }

    const items=files.map(f=>itemCache.get(f.filename)).filter(Boolean);
    if(items.length){
      renderTranscripts(items);
      lastRenderedIds=idKey;
    }
  }finally{
    inFlight=false;
  }
}

/* ==== RENDER ==== */
function renderTranscripts(items){
  const container=document.getElementById('transcripts');
  const audioPlayer=document.getElementById('audioPlayer');
  const audioSource=document.getElementById('audioSource');
  if(!container) return;

  const frag=document.createDocumentFragment();
  for(const {id,time,transcriptHtml,mp3Link,color,noise} of items){
    const div=document.createElement('div');
    div.className='transcript';
    if(noise) div.classList.add('transcript-noise');
    if(renderedIds && !renderedIds.has(id)) div.classList.add('transcript-new');
    if(color==='red') div.classList.add('highlight-red');
    else if(color==='yellow') div.classList.add('highlight-yellow');
    else if(color==='orange') div.classList.add('highlight-orange');

    const timeSpan=document.createElement('span');
    timeSpan.style.fontWeight='bold';
    timeSpan.textContent=`${time}: `;
    div.appendChild(timeSpan);

    const textSpan=document.createElement('span');
    textSpan.innerHTML=transcriptHtml;
    div.appendChild(textSpan);

    const listen=document.createElement('a');
    listen.href='#';
    listen.textContent='▶ Listen';
    listen.className='listen-btn';
    listen.addEventListener('click',e=>{
      e.preventDefault();
      if(!audioPlayer||!audioSource) return;
      audioSource.src=mp3Link;
      audioPlayer.load();
      audioPlayer.play().catch(()=>{});
    });
    div.appendChild(listen);

    const copyIcon=document.createElement('span');
    copyIcon.textContent='📋';
    copyIcon.className='copy-icon';

    const tooltip=document.createElement('span');
    tooltip.className='tooltip';
    tooltip.textContent='Copied!';
    copyIcon.appendChild(tooltip);

    copyIcon.addEventListener('click',()=>{
      const tmp=document.createElement('div');
      tmp.innerHTML=transcriptHtml;
      const plain=tmp.textContent||tmp.innerText||'';
      navigator.clipboard.writeText(plain).then(()=>{
        tooltip.style.visibility='visible';
        tooltip.style.opacity='1';
        setTimeout(()=>{
          tooltip.style.visibility='hidden';
          tooltip.style.opacity='0';
        },1500);
      }).catch(()=>{});
    });

    div.appendChild(copyIcon);
    frag.appendChild(div);
  }
  container.replaceChildren(frag);
  renderedIds=new Set(items.map(it=>it.id));
}

/* ==== CHANNEL TABS + LIVE STATUS ==== */
function buildFeedNav(){
  const header=document.querySelector('.site-header');
  if(!header) return;
  const currentDir=location.pathname.split('/').filter(Boolean)[0];
  const onSpecial=location.pathname.endsWith('/special.html');

  const nav=document.createElement('nav');
  nav.className='feed-nav';
  nav.setAttribute('aria-label','Channels');

  const tabs=document.createElement('div');
  tabs.className='feed-tabs';
  for(const {dir,label} of FEEDS){
    const a=document.createElement('a');
    a.className='feed-tab';
    a.textContent=label;
    // Stay on the same view (regular vs. extended) when switching channels
    a.href=`/${dir}/${onSpecial?'special.html':''}`;
    if(dir===currentDir){
      a.classList.add('active');
      a.setAttribute('aria-current','page');
    }
    tabs.appendChild(a);
  }
  nav.appendChild(tabs);

  const status=document.createElement('div');
  status.className='live-status';
  status.id='liveStatus';
  status.textContent='Connecting…';
  nav.appendChild(status);

  header.after(nav);
}

function updateLiveStatus(){
  const el=document.getElementById('liveStatus');
  if(!el) return;
  const now=timeFmt.format(new Date()).split(', ')[1];
  el.classList.toggle('offline',!lastPollOk);
  el.textContent=lastPollOk ? `Live · updated ${now}` : `Can't reach archive · retrying (${now})`;
}

/* ==== BOOT ==== */
async function runPoll(){
  await fetchTranscriptsOnce();
  updateLiveStatus();
  // Clear first so a visibility change mid-fetch can't leave two timer chains running
  clearTimeout(pollTimer);
  pollTimer = document.hidden ? null : setTimeout(runPoll, POLL_MS);
}

buildFeedNav();
runPoll();
