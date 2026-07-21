export const WINDOWS_METRICS_MARKER = 'MCSTOOLS_METRICS:'

export function encodeWindowsPowerShellCommand(script: string): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`
}

export function decodeWindowsMetricsJson(output: string): Record<string, unknown> {
  const normalized = output
    .replace(/\u0000/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/^\uFEFF/, '')
    .trim()

  const markerIndex = normalized.lastIndexOf(WINDOWS_METRICS_MARKER)
  if (markerIndex >= 0) {
    const markedOutput = normalized.slice(markerIndex + WINDOWS_METRICS_MARKER.length)
    const encoded = markedOutput.match(/^[A-Za-z0-9+/]+={0,2}/)?.[0]
    if (!encoded) throw new Error('Windows 指标数据为空')
    const json = Buffer.from(encoded, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  }

  // Keep compatibility with data returned by builds before the marked payload protocol.
  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  const json = firstBrace >= 0 && lastBrace > firstBrace
    ? normalized.slice(firstBrace, lastBrace + 1)
    : normalized
  return JSON.parse(json) as Record<string, unknown>
}
