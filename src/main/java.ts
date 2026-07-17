import { execSync } from 'child_process'

export interface JavaInfo {
  path: string
  version: string
  majorVersion: number
}

export function detectJava(): JavaInfo | null {
  const candidates = process.platform === 'win32'
    ? [
      'java',
      process.env.JAVA_HOME ? `${process.env.JAVA_HOME}\\bin\\java` : '',
    ]
    : [
      'java',
      process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : '',
      '/usr/bin/java',
      '/opt/homebrew/opt/openjdk/bin/java',
      '/Library/Java/JavaVirtualMachines/openjdk.jdk/Contents/Home/bin/java',
      '/usr/lib/jvm/default-java/bin/java',
    ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const out = execSync(`"${candidate}" -version 2>&1`).toString()
      const match = out.match(/(?:openjdk|java) version "(\d+)/i)
      if (match) {
        return {
          path: candidate,
          version: match[0],
          majorVersion: parseInt(match[1], 10),
        }
      }
    } catch { continue }
  }
  return null
}
