function accountErrorText(provider, error) {
  const message = String(error?.message || 'Bilinmeyen hata').replace(/\s+/g, ' ').trim();
  if (provider === 'codex') {
    if (/token[_ ]invalidated|authentication token has been invalidated|401|unauthorized/i.test(message)) {
      return 'Oturum arka planda korunuyor';
    }
    if (/failed to fetch|fetch failed|network|econn|enotfound|etimedout|zaman aşımı/i.test(message)) {
      return 'Bağlantı arka planda yenileniyor';
    }
  }
  return message.slice(0, 180);
}

module.exports = { accountErrorText };
