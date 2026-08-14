let state, pendingProvider;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const remaining = used => used == null ? null : Math.max(0, 100 - used);
function meter(left){const level=left<20?'danger':left<45?'warn':'';return `<div class="meter ${level}"><i style="width:${left}%"></i></div>`}
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
function duration(minutes,fallback){if(!minutes)return fallback;if(minutes===300)return '5 saatlik';if(minutes===10080)return 'Haftalık';if(minutes<1440)return `${Math.round(minutes/60)} saatlik`;return `${Math.round(minutes/1440)} günlük`}
function card(a){const p=remaining(a.usage?.primaryUsed),s=remaining(a.usage?.secondaryUsed);return `<article class="card ${a.provider}"><div class="account-head"><div><span class="provider">${a.provider==='codex'?'CODEX':'CLAUDE · DENEYSEL'}</span><h3>${esc(a.name)}</h3></div><span class="status" title="${esc(a.statusText)}">${a.status==='ok'?'● Bağlı':'○ '+esc(a.statusText)}</span></div>${p==null?'':`<div class="metric"><div class="row"><span>${duration(a.usage.primaryMinutes,'Alt limit')}</span><b>%${Math.round(p)} kaldı</b></div>${meter(p)}<small>Sıfırlanma: ${when(a.usage.primaryReset)}</small></div>`}${s==null?'':`<div class="metric"><div class="row"><span>${duration(a.usage.secondaryMinutes,'Haftalık')}</span><b>%${Math.round(s)} kaldı</b></div>${meter(s)}<small>Sıfırlanma: ${when(a.usage.secondaryReset)}</small></div>`}<div class="card-actions"><button data-login="${a.id}" data-provider="${a.provider}" class="secondary">Yeniden bağla</button><button data-remove="${a.id}" data-provider="${a.provider}" class="secondary">Kaldır</button></div></article>`}
async function init(){state=await window.limits.state();$('#interval').value=state.settings.refreshMinutes;render(state.snapshot);window.limits.onSnapshot(render)}
document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{pendingProvider=b.dataset.add;$('#dialogTitle').textContent=`${pendingProvider==='codex'?'Codex':'Claude'} hesabı ekle`;$('#profileName').value='';$('#addDialog').showModal()});
$('#confirmAdd').onclick=async e=>{e.preventDefault();const name=$('#profileName').value.trim();if(!name)return;$('#addDialog').close();render(await window.limits.add(pendingProvider,name))};
$('#refresh').onclick=async()=>render(await window.limits.refresh());$('#interval').onchange=e=>window.limits.setRefresh(e.target.value);init();
