export type PlayerConnectionAction = 'join' | 'leave'

export interface PlayerConnectionEvent {
  action: PlayerConnectionAction
  playerName: string
}

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g
const MINECRAFT_FORMAT_PATTERN = /\u00A7[0-9A-FK-OR]/gi

export function parsePlayerConnectionEvent(line: string): PlayerConnectionEvent | null {
  if (typeof line !== 'string' || !line) return null

  const plainLine = line
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(MINECRAFT_FORMAT_PATTERN, '')
    .trim()
  const match = plainLine.match(/(?:^|.*(?:\]:\s*|:\s+))([^:\r\n]+?)\s+(joined|left) the game\.?\s*$/i)
  if (!match) return null

  const playerName = match[1].trim()
  if (!playerName || playerName.length > 64) return null

  return {
    action: match[2].toLowerCase() === 'joined' ? 'join' : 'leave',
    playerName,
  }
}
