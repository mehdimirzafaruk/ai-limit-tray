function percent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function codex(raw) {
  const value = raw?.rateLimits || raw || {};
  const primary = value.primary || value.primaryWindow || value.primary_window || {};
  const secondary = value.secondary || value.secondaryWindow || value.secondary_window || {};
  return {
    primaryUsed: percent(primary.usedPercent ?? primary.used_percent),
    primaryReset: primary.resetsAt ?? primary.resetAt ?? primary.reset_at ?? null,
    primaryMinutes: primary.windowDurationMins ?? primary.window_duration_mins ?? null,
    secondaryUsed: percent(secondary.usedPercent ?? secondary.used_percent),
    secondaryReset: secondary.resetsAt ?? secondary.resetAt ?? secondary.reset_at ?? null,
    secondaryMinutes: secondary.windowDurationMins ?? secondary.window_duration_mins ?? null,
    credits: value.credits?.balance ?? value.creditsBalance ?? null
  };
}

function claude(raw) {
  const five = raw.five_hour || raw.fiveHour || {};
  const week = raw.seven_day || raw.sevenDay || {};
  return {
    primaryUsed: percent(five.utilization), primaryReset: five.resets_at || null, primaryMinutes: 300,
    secondaryUsed: percent(week.utilization), secondaryReset: week.resets_at || null, secondaryMinutes: 10080,
    credits: null
  };
}

function aggregate(accounts) {
  const valid = accounts.filter(a => a.status === 'ok' && a.usage?.primaryUsed != null);
  const capacity = valid.length * 100;
  const remaining = valid.reduce((sum, a) => sum + 100 - a.usage.primaryUsed, 0);
  return { accounts: valid.length, capacity, remaining: Math.round(remaining * 10) / 10,
    remainingPercent: capacity ? Math.round(remaining / capacity * 1000) / 10 : null };
}

module.exports = { codex, claude, aggregate };
