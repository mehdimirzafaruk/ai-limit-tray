const summary=document.querySelector('#summary'),updated=document.querySelector('#updated');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=t=>t?.accounts?`%${t.remainingPercent} kaldı`:'Hesap yok';
function render(s){
  updated.textContent=s.updatedAt?`Son yenileme ${new Date(s.updatedAt).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}`:'Henüz yenilenmedi';
  const codex=s.accounts.filter(a=>a.provider==='codex');
  summary.innerHTML=`<div class="line claude"><span>Claude toplam</span><strong>${label(s.claudeTotal)}</strong></div><div class="line"><span>Codex toplam</span><strong>${label(s.codexTotal)}</strong></div>${codex.map(a=>{const left=a.usage?.primaryUsed==null?null:Math.round(100-a.usage.primaryUsed);return `<div class="line account"><span title="${esc(a.name)}">${esc(a.name)}</span>${left==null?`<span class="error">${esc(a.statusText)}</span>`:`<strong>%${left} kaldı</strong>`}</div>`}).join('')}`;
}
window.limits.state().then(x=>render(x.snapshot));
window.limits.onSnapshot(render);
