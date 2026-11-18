type Clip = { id: string; name: string; bytes: number; writable: boolean };
type Settings = {
  selectedClipId: string | null;
  playOnAppStart: boolean;
  randomPlayback: boolean;
  fitMode: "cover" | "contain";
  pinnedSessions: string[];
  conversationOverrides: Record<string, string>;
};

export type LibrarySnapshot = {
  clips: Clip[];
  settings: Settings;
  sessionId: string;
  message: string;
};

const safeJson = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

/** Self-contained opaque-origin document. All mutations go through declared UI actions. */
export function overlaySurface(input: {
  mode: "video" | "library";
  clipId: string | null;
  endpoint: string;
  snapshot?: LibrarySnapshot;
}): string {
  const payload = safeJson(input);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{
      font:13px system-ui,-apple-system,sans-serif;
      color-scheme:light dark;
      background:transparent;
      --panel:light-dark(#fbfbfc,#161e29);
      --ink:light-dark(#20242b,#edf2f7);
      --muted:light-dark(#565f6c,#aab8c8);
      --line:light-dark(#d8dce2,#405064);
      --control:light-dark(#f1f3f6,#243141);
      --hover:light-dark(#e4e7ec,#31455b);
      color:var(--ink);
    }
    :root[data-theme=light]{color-scheme:light}
    :root[data-theme=dark]{color-scheme:dark}
    *{box-sizing:border-box}body{margin:0;min-height:100vh}button,select{font:inherit}button{cursor:pointer}
    :is(button,select,input):focus{outline:none}
    .video{position:fixed;inset:0;display:grid;place-items:center;background:#080e19;color:#edf2f7;color-scheme:dark}
    video{width:100%;height:100%;display:block;background:#080e19}
    .skip{position:absolute;right:20px;top:44px;z-index:1;border:1px solid #ffffff55;background:#111b2add;color:white;border-radius:8px;padding:7px 12px}
    .skip:is(:hover,:focus-visible){background:#25354a}
    .brand{display:grid;place-items:center;gap:22px;letter-spacing:.22em;font-weight:700;font-size:clamp(32px,7vw,78px)}
    .orbit{width:82px;height:82px;border:3px solid #69b9ec;border-left-color:transparent;border-radius:50%;animation:spin 1.4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    .veil{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgb(0 0 0 / .18)}
    .library{width:min(760px,100%);max-height:min(760px,calc(100vh - 48px));display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 44px #0004;overflow:hidden}
    .head{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--line)}.head h1{font-size:16px;margin:0;font-weight:650}
    .body{padding:14px 18px;overflow:auto;display:grid;gap:14px}.group{display:grid;gap:8px}.group h2{font-size:12px;color:var(--muted);margin:0;font-weight:600}
    .row{display:flex;align-items:center;gap:8px;min-height:34px}.row .name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.muted,.status{color:var(--muted)}.status:empty{display:none}
    .clip{border:1px solid var(--line);border-radius:8px;padding:6px 8px}.clip.selected{background:var(--control)}.clip small{color:var(--muted)}
    .controls{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.controls label{display:flex;align-items:center;gap:5px}
    .btn{border:1px solid var(--line);background:var(--control);color:var(--ink);border-radius:6px;padding:5px 9px;min-height:28px}.btn.quiet{background:transparent;border-color:transparent}.btn:is(:hover,:focus-visible),select:focus-visible,label:has(input:focus-visible){background:var(--hover)}
    select{background:var(--control);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 6px;max-width:220px}
    @media(prefers-reduced-motion:reduce){.orbit{animation:none}}
  </style></head><body><div id="app"></div><script>
    const data=${payload};const app=document.getElementById('app');
    window.addEventListener('message',event=>{
      if(event.source!==parent||event.data?.type!=='yomni.plugin.snapshot')return;
      const theme=event.data.context?.theme;
      if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;
    });
    const act=(action,value)=>parent.postMessage({type:'yomni.plugin.action',action,...(value===undefined?{}:{value:String(value)})},'*');
    const button=(label,action,value,kind='')=>{const b=document.createElement('button');b.type='button';b.className='btn '+kind;b.textContent=label;b.addEventListener('click',()=>act(action,value));return b};
    const row=()=>{const e=document.createElement('div');e.className='row';return e};
    if(data.mode==='video'){
      app.className='video';const skip=button('跳过 ×','skip');skip.className='skip';app.append(skip);
      if(data.clipId){const video=document.createElement('video');video.src=data.endpoint+'/media/'+encodeURIComponent(data.clipId);video.style.objectFit=data.snapshot?.settings.fitMode||'cover';video.autoplay=true;video.playsInline=true;video.addEventListener('ended',()=>act('ended'),{once:true});video.addEventListener('error',()=>act('ended'),{once:true});app.prepend(video);void video.play().catch(()=>{video.muted=true;return video.play().catch(()=>act('ended'))});setTimeout(()=>{if(video.readyState<3)act('ended')},25000)}
      else{const brand=document.createElement('div');brand.className='brand';const orbit=document.createElement('span');orbit.className='orbit';const text=document.createElement('strong');text.textContent='Yomni';brand.append(orbit,text);app.prepend(brand);setTimeout(()=>act('ended'),2500)}
      window.addEventListener('keydown',e=>{if(e.key==='Escape')act('skip')});skip.focus();
    }else{
      app.className='veil';const s=data.snapshot,settings=s.settings,panel=document.createElement('section');panel.className='library';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','片头片库');
      const head=document.createElement('header');head.className='head';const title=document.createElement('h1');title.textContent='片头片库';head.append(title,button('关闭','close',undefined,'quiet'));panel.append(head);
      const body=document.createElement('div');body.className='body';const status=document.createElement('div');status.className='status';status.setAttribute('role','status');status.textContent=s.message||'';body.append(status);
      const options=document.createElement('div');options.className='group';const optionsTitle=document.createElement('h2');optionsTitle.textContent='播放设置';options.append(optionsTitle);
      const toggles=row();for(const [key,label] of [['playOnAppStart','启动时播放'],['randomPlayback','随机播放']]){const l=document.createElement('label');const c=document.createElement('input');c.type='checkbox';c.checked=settings[key];c.addEventListener('change',()=>act('setting',JSON.stringify({key,value:c.checked})));l.append(c,document.createTextNode(label));toggles.append(l)}options.append(toggles);
      const fit=row();const fitLabel=document.createElement('span');fitLabel.textContent='画面';const fitSelect=document.createElement('select');for(const [value,label] of [['cover','铺满'],['contain','完整显示']]){const o=document.createElement('option');o.value=value;o.textContent=label;fitSelect.append(o)}fitSelect.value=settings.fitMode;fitSelect.addEventListener('change',()=>act('setting',JSON.stringify({key:'fitMode',value:fitSelect.value})));fit.append(fitLabel,fitSelect);options.append(fit);
      const session=row();if(s.sessionId){const pin=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.checked=settings.pinnedSessions.includes(s.sessionId);box.addEventListener('change',()=>act('pin'));pin.append(box,document.createTextNode('每次进入当前会话时播放'));session.append(pin);if(settings.conversationOverrides[s.sessionId])session.append(button('清除会话指定片头','override',''));}else{const hint=document.createElement('span');hint.className='muted';hint.textContent='打开一个会话后可单独指定片头。';session.append(hint)}options.append(session);body.append(options);
      const clips=document.createElement('div');clips.className='group';const clipsTitle=document.createElement('h2');clipsTitle.textContent='视频';clips.append(clipsTitle);
      const brand=row();brand.className='row clip'+(settings.selectedClipId==='default'?' selected':'');const brandName=document.createElement('span');brandName.className='name';brandName.textContent='Yomni 动画';brand.append(brandName,button('预览','preview','default'),button('选它','select','default'));clips.append(brand);
      for(const clip of s.clips){const item=row();item.className='row clip'+(settings.selectedClipId===clip.id?' selected':'');const name=document.createElement('span');name.className='name';name.textContent=clip.name;name.title=clip.name;item.append(name,button('预览','preview',clip.id),button('选它','select',clip.id));if(s.sessionId)item.append(button('仅本会话','override',clip.id));if(clip.writable)item.append(button('删除','delete',clip.id,'danger'));clips.append(item)}body.append(clips);
      const foot=document.createElement('div');foot.className='controls';foot.append(button('导入视频','upload'),button('播放当前选择','play'));body.append(foot);panel.append(body);app.append(panel);
      window.addEventListener('keydown',e=>{if(e.key==='Escape')act('close')});head.querySelector('button')?.focus();
    }
    parent.postMessage({type:'yomni.plugin.ready'},'*');
  </script></body></html>`;
}
