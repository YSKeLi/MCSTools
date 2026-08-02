export function withPersistentFrpLogin(content: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = /\r?\n$/.test(content)
  const lines = content.split(/\r?\n/)
  if (hadTrailingNewline) lines.pop()

  const firstTableIndex = lines.findIndex(line => /^\s*\[/.test(line))
  const globalEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length
  const loginFailExitIndex = lines.findIndex((line, index) => (
    index < globalEnd && /^\s*loginFailExit\s*=/.test(line)
  ))

  if (loginFailExitIndex >= 0) {
    lines[loginFailExitIndex] = 'loginFailExit = false'
  } else {
    lines.splice(globalEnd, 0, 'loginFailExit = false', '')
  }

  return `${lines.join(newline)}${newline}`
}
