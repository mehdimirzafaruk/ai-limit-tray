const LOW_LIMIT_THRESHOLD = 20;

function percent(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 10) / 10)) : null;
}

function limitLabel(minutes, fallback) {
  const value = Number(minutes);
  if (value === 300) return '5 saatlik';
  if (value === 10080) return 'Haftalık';
  if (Number.isFinite(value) && value > 0 && value < 1440) return `${Math.round(value / 60)} saatlik`;
  if (Number.isFinite(value) && value >= 1440) return `${Math.round(value / 1440)} günlük`;
  return fallback;
}

function normalizedLimit(value, fallbackLabel, fallbackMinutes) {
  if (!value || typeof value !== 'object') return null;
  const usedPct = percent(value.usedPct ?? value.usedPercentage ?? value.used_percentage ?? value.utilization);
  const explicitRemaining = percent(value.remainingPct ?? value.remainingPercentage ?? value.remaining_percentage);
  const remainingPct = explicitRemaining ?? (usedPct == null ? null : percent(100 - usedPct));
  if (usedPct == null && remainingPct == null) return null;
  const windowMinutes = Number(value.windowMinutes ?? value.windowDurationMins ?? fallbackMinutes) || fallbackMinutes || null;
  return {
    label: String(value.label || limitLabel(windowMinutes, fallbackLabel)),
    windowMinutes,
    usedPct: usedPct ?? percent(100 - remainingPct),
    remainingPct,
    resetsAt: value.resetsAt ?? value.resets_at ?? null
  };
}

function normalizeRateLimits(value = {}) {
  const primary = normalizedLimit(value.primary || value.five_hour || value.fiveHour, '5 saatlik', 300);
  const secondary = normalizedLimit(value.secondary || value.seven_day || value.sevenDay, 'Haftalık', 10080);
  return { primary, secondary };
}

function limitsFromUsage(usage) {
  if (!usage) return { primary: null, secondary: null };
  return normalizeRateLimits({
    primary: {
      usedPct: usage.primaryUsed,
      resetsAt: usage.primaryReset,
      windowMinutes: usage.primaryMinutes
    },
    secondary: {
      usedPct: usage.secondaryUsed,
      resetsAt: usage.secondaryReset,
      windowMinutes: usage.secondaryMinutes
    }
  });
}

function lowLimitWarnings(rateLimits, threshold = LOW_LIMIT_THRESHOLD) {
  const normalized = normalizeRateLimits(rateLimits);
  return [normalized.primary, normalized.secondary]
    .filter(limit => limit?.remainingPct != null && limit.remainingPct <= threshold)
    .sort((a, b) => a.remainingPct - b.remainingPct);
}

module.exports = {
  LOW_LIMIT_THRESHOLD,
  limitLabel,
  limitsFromUsage,
  lowLimitWarnings,
  normalizeRateLimits
};
