export function requiredJavaMajor(minecraftVersion: string): number {
  const match = minecraftVersion.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return 17
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] || 0)
  if (major !== 1) return 21
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21
  if (minor >= 18) return 17
  if (minor === 17) return 16
  return 8
}
