let state, pendingProvider;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const remaining = used => used == null ? null : Math.max(0, 100 - used);
function meter(left){const value=Math.max(0,Math.min(100,Number(left)||0));const level=value<20?'danger':value<45?'warn':'';return `<div class="meter ${level}" role="progressbar" aria-label="Kalan oran" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i style="width:${value}%"></i></div>`}
function when(value){if(!value)return '—';const date=new Date(typeof value==='number'&&value<1e12?value*1000:value);return isNaN(date)?'—':date.toLocaleString('tr-TR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function render(snapshot){
  state.snapshot=snapshot;
  renderTotal('#claudeTotal','CLAUDE TOPLAM',snapshot.claudeTotal,'claude');
  renderTotal('#codexTotal','CODEX TOPLAM',snapshot.codexTotal,'');
  $('#updated').textContent=snapshot.updatedAt?`Son yenileme: ${new Date(snapshot.updatedAt).toLocaleTimeString('tr-TR')}`:'Henüz yenilenmedi';
  $('#accounts').innerHTML=snapshot.accounts.length?snapshot.accounts.map(card).join(''):`<div class="empty">Henüz hesap eklenmedi. Codex veya Claude hesabını bağlayarak başla.</div>`;
  document.querySelectorAll('[data-login]').forEach(b=>b.onclick=()=>window.limits.login(b.dataset.provider,b.dataset.login));
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{if(confirm('Bu profili kaldırmak istiyor musun?'))render(await window.limits.remove(b.dataset.provider,b.dataset.remove))});
}
function renderTotal(selector,label,t,kind){const el=$(selector);el.className=`total ${kind}`;el.innerHTML=t?.accounts?`<span class="eyebrow">${label} · ${t.accounts} HESAP</span><div><strong>%${t.remainingPercent}</strong> kullanılabilir <small>· ${t.remaining} / ${t.capacity} hesap-kota birimi</small></div>${meter(t.remainingPercent)}`:`<span class="eyebrow">${label}</span><h2>Henüz bağlı hesap yok</h2>`}
function limitWarnings(chat){return ['primary','secondary'].map(key=>chat?.rateLimits?.[key]).filter(limit=>limit&&Number.isFinite(Number(limit.remainingPct))&&Number(limit.remainingPct)<=20).sort((a,b)=>Number(a.remainingPct)-Number(b.remainingPct))}
function limitWarningHtml(chat){const warnings=limitWarnings(chat);if(!warnings.length)return '';const critical=warnings.some(limit=>Number(limit.remainingPct)<=10)?' critical':'';return `<div class="limit-warning${critical}"><span>⚠ Limit uyarısı</span>${warnings.map(limit=>`<strong>${esc(limit.label)}: %${Math.max(0,Math.round(Number(limit.remainingPct)*10)/10)} kaldı</strong>`).join('')}</div>`}
function compactNoticeHtml(chat){if(!chat?.compacted)return '';const count=Math.max(1,Number(chat.compactionCount)||1);const time=chat.compactedAt?new Date(chat.compactedAt).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):null;const before=Number(chat.compactionBeforeTokens),after=Number(chat.compactionAfterTokens);const tokenChange=chat.compactionBeforeTokens!=null&&chat.compactionAfterTokens!=null&&Number.isFinite(before)&&Number.isFinite(after)?`${before.toLocaleString('tr-TR')} → ${after.toLocaleString('tr-TR')} token`:null;return `<div class="compact-notice"><span>↻ Compact uygulandı</span><strong>${[`${count} kez`,time,tokenChange].filter(Boolean).join(' · ')}</strong></div>`}
function contextCard(chat){
  const title=esc(chat.title||'İsimsiz sohbet');
  const isClaude=String(chat.source||'').startsWith('claude');
  const model=esc(chat.model||(isClaude?'Claude':'Codex'));
  const provider=chat.source==='claude-desktop'?'CLAUDE DESKTOP · AKTİF SOHBET':isClaude?'CLAUDE CODE · AKTİF OTURUM':'CODEX · AKTİF SOHBET';
  const sourceClass=isClaude?' claude':'';
  const limitAlert=limitWarningHtml(chat);
  const compactAlert=compactNoticeHtml(chat);
  if(chat.remainingPct==null||chat.usedTokens==null||chat.contextLimit==null){
    return `<article class="context-card${sourceClass}"><div class="context-title"><div><span class="eyebrow">${provider}</span><h3 title="${title}">${title}</h3></div><b>Hazırlanıyor</b></div><small>${model} · ${esc(chat.reason||'İlk token verisi bekleniyor.')}</small>${compactAlert}${limitAlert}</article>`;
  }
  const left=Math.max(0,Math.round(chat.remainingPct*10)/10);
  return `<article class="context-card${sourceClass}"><div class="context-title"><div><span class="eyebrow">${provider}</span><h3 title="${title}">${title}</h3></div><strong>%${left}</strong></div><div class="context-detail"><span>context kaldı${chat.estimated?' · tahmini':''}</span><small>${model} · ${chat.estimated?'≈ ':''}${chat.usedTokens.toLocaleString('tr-TR')} / ${chat.contextLimit.toLocaleString('tr-TR')} token</small></div>${meter(left)}${compactAlert}${limitAlert}</article>`;
}
function renderContext(c){
  const el=$('#activeContexts');if(!el)return;
  const chats=Array.isArray(c?.chats)?c.chats:[];
  el.innerHTML=chats.length?chats.map(contextCard).join(''):`<div class="context-empty">${esc(c?.reason||'Aktif Codex, Claude Desktop veya Claude Code oturumu algılanmadı.')}</div>`;
  const checked=$('#contextChecked');if(checked)checked.textContent=c?.checkedAt?`Son kontrol: ${new Date(c.checkedAt).toLocaleTimeString('tr-TR')}`:'Codex ve Claude Desktop izleniyor';
}
function duration(minutes,fallback){if(!minutes)return fallback;if(minutes===300)return '5 saatlik';if(minutes===10080)return 'Haftalık';if(minutes<1440)return `${Math.round(minutes/60)} saatlik`;return `${Math.round(minutes/1440)} günlük`}
function card(a){const p=remaining(a.usage?.primaryUsed),s=remaining(a.usage?.secondaryUsed);const status=a.status==='ok'?'● Bağlı':a.status==='recovering'?'◌ Oturum korunuyor':'○ '+esc(a.statusText);return `<article class="card ${a.provider}"><div class="account-head"><div><span class="provider">${a.provider==='codex'?'CODEX':'CLAUDE · DENEYSEL'}</span><h3>${esc(a.name)}</h3></div><span class="status" title="${esc(a.statusText)}">${status}</span></div>${p==null?'':`<div class="metric"><div class="row"><span>${duration(a.usage.primaryMinutes,'Alt limit')}</span><b>%${Math.round(p)} kaldı</b></div>${meter(p)}<small>Sıfırlanma: ${when(a.usage.primaryReset)}</small></div>`}${s==null?'':`<div class="metric"><div class="row"><span>${duration(a.usage.secondaryMinutes,'Haftalık')}</span><b>%${Math.round(s)} kaldı</b></div>${meter(s)}<small>Sıfırlanma: ${when(a.usage.secondaryReset)}</small></div>`}<div class="card-actions"><button data-login="${a.id}" data-provider="${a.provider}" class="secondary">Oturumu yenile</button><button data-remove="${a.id}" data-provider="${a.provider}" class="secondary">Kaldır</button></div></article>`}
async function init(){state=await window.limits.state();$('#interval').value=state.settings.refreshMinutes;render(state.snapshot);renderContext(state.context);window.limits.onSnapshot(render);window.limits.onContext(renderContext)}
document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{pendingProvider=b.dataset.add;$('#dialogTitle').textContent=`${pendingProvider==='codex'?'Codex':'Claude'} hesabı ekle`;$('#profileName').value='';$('#addDialog').showModal()});
$('#confirmAdd').onclick=async e=>{e.preventDefault();const name=$('#profileName').value.trim();if(!name)return;$('#addDialog').close();render(await window.limits.add(pendingProvider,name))};
$('#refresh').onclick=async()=>render(await window.limits.refresh());$('#interval').onchange=e=>window.limits.setRefresh(e.target.value);init();
