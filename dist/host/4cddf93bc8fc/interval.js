export const INTERVAL_ERROR = 'Use m, h and d, optionally combined, such as 45m, 1h30m or 2d. The interval must be between 1 minute and 30 days.'

/** Parse ordered duration units and return a canonical minute-resolution interval. */
export function parseInterval(value) {
  if (typeof value !== 'string') throw new Error(INTERVAL_ERROR)
  const text = value.replace(/\s/g, '').toLowerCase()
  const match = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
  if (!match || !text) throw new Error(INTERVAL_ERROR)
  const minutes = Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 43200) throw new Error(INTERVAL_ERROR)
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60
  return { interval: `${days ? `${days}d` : ''}${hours ? `${hours}h` : ''}${rest ? `${rest}m` : ''}`, milliseconds: minutes * 60000 }
}
