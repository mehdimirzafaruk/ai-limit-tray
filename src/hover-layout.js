function hoverSize(codexRows, contextRows = 0, warningRows = 0) {
  const rows = Math.max(0, Number(codexRows) || 0);
  const contexts = contextRows === true ? 1 : Math.max(0, Number(contextRows) || 0);
  const warnings = Math.min(Math.max(0, Number(warningRows) || 0), Math.min(contexts, 4));
  const contextExtra = contexts ? 18 + Math.min(contexts, 4) * 42 + warnings * 20 : 0;
  return {
    width: 390,
    height: Math.max(180, Math.min(460, 82 + (2 + rows) * 32 + contextExtra))
  };
}

module.exports = { hoverSize };
