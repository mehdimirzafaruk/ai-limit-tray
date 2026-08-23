const summary=document.querySelector('#summary'),updated=document.querySelector('#updated'),pin=document.querySelector('#pin'),context=document.querySelector('#context');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=t=>t?.accounts?`%${t.remainingPercent} kaldı`:'Hesap yok';
function limitWarnings(snap){return ['primary','secondary'].map(key=>snap?.rateLimits?.[key]).filter(limit=>limit&&Number.isFinite(Number(limit.remainingPct))&&Number(limit.remainingPct)<=20).sort((a,b)=>Number(a.remainingPct)-Number(b.remainingPct))}
function compactNotice(snap){if(!snap?.compacted)return '';const count=Math.max(1,Number(snap.compactionCount)||1);return `<div class="ctx-compact">↻ Compact${count>1?` ×${count}`:''} uygulandı</div>`}
function ctxBlock(snap){
  const title=esc(snap.title||'İsimsiz sohbet');
  const provider=String(snap.source||'').startsWith('claude')?'Claude · ':'Codex · ';
  const warnings=limitWarnings(snap);
  const warning=warnings.length?`<div class="ctx-limit-warning${warnings.some(limit=>Number(limit.remainingPct)<=10)?' critical':''}">⚠ ${warnings.map(limit=>`${esc(limit.label)} %${Math.max(0,Math.round(Number(limit.remainingPct)*10)/10)}`).join(' · ')} kaldı</div>`:'';
  const compact=compactNotice(snap);
  if(snap.remainingPct==null)return `<div class="ctx-row"><span title="${title}">${provider}${title}</span><span class="ctx-empty">hazırlanıyor</span></div>${compact}${warning}`;
  const left=Math.max(0,Math.round(snap.remainingPct*10)/10);
  const cls=left<15?'danger':left<35?'warn':'';
  return `<div class="ctx-row"><span title="${title}">${provider}${title}</span><strong class="${cls}">%${left}</strong></div><div class="meter ${cls}" role="progressbar" aria-label="${title} kalan context oranı" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${left}"><i style="width:${left}%"></i></div>${compact}${warning}`;
}
function renderContext(c){
  if(!context)return;
  const chats=Array.isArray(c?.chats)?c.chats:[];
  context.hidden=!chats.length;
  context.innerHTML=chats.slice(0,4).map(ctxBlock).join('');
}
function render(s){
  updated.textContent=s.updatedAt?`Son yenileme ${new Date(s.updatedAt).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}`:'Henüz yenilenmedi';
  pin.classList.toggle('active',!!s.stickyHover);
  pin.title=s.stickyHover?'Sabit - kaldırmak için tıkla':'Sabit değil - sabitlemek için tıkla';
  const codex=s.accounts.filter(a=>a.provider==='codex');
  summary.innerHTML=`<div class="line claude"><span>Claude toplam</span><strong>${label(s.claudeTotal)}</strong></div><div class="line"><span>Codex toplam</span><strong>${label(s.codexTotal)}</strong></div>${codex.map(a=>{const left=a.usage?.primaryUsed==null?null:Math.round(100-a.usage.primaryUsed);return `<div class="line account"><span title="${esc(a.name)}">${esc(a.name)}</span>${left==null?`<span class="error">${esc(a.statusText)}</span>`:`<strong>%${left} kaldı${a.status==='ok'?'':' · son veri'}</strong>`}</div>`}).join('')}`;
}
pin.onclick=()=>window.limits.toggleSticky();
window.limits.state().then(x=>{render(x.snapshot);renderContext(x.context)});
window.limits.onSnapshot(render);
window.limits.onContext(renderContext);
