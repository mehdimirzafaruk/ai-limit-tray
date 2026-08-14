function hoverSize(codexRows) {
  const rows = Math.max(0, Number(codexRows) || 0);
  return {
    width: 390,
    height: Math.max(180, Math.min(460, 82 + (2 + rows) * 32))
  };
}

module.exports = { hoverSize };
