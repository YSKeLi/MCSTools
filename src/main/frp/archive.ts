import extractZip from 'extract-zip'
import * as path from 'path'
import { extract as extractTar } from 'tar'

export async function extractFrpArchive(archivePath: string, extractDirectory: string): Promise<void> {
  const lowerPath = archivePath.toLowerCase()
  const destination = path.resolve(extractDirectory)

  if (lowerPath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: destination })
    return
  }

  if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz')) {
    await extractTar({ file: archivePath, cwd: destination, gzip: true, strict: true })
    return
  }

  throw new Error(`不支持的 FRP 压缩包格式: ${path.basename(archivePath)}`)
}
