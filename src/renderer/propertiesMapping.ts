export interface PropField {
  label: string
  desc: string
  type: 'string' | 'number' | 'bool' | 'enum'
  options?: string[]
}

export const PROP_MAP: Record<string, PropField> = {
  'motd':                     { label: '服务器描述',     desc: '显示在服务器列表的描述文字', type: 'string' },
  'server-port':              { label: '服务器端口',     desc: '服务器监听的端口号', type: 'number' },
  'max-players':              { label: '最大玩家数',     desc: '同时在线最大玩家数', type: 'number' },
  'online-mode':              { label: '正版验证',       desc: '是否开启 Mojang 正版验证', type: 'bool' },
  'difficulty':               { label: '难度',           desc: '游戏难度', type: 'enum', options: ['peaceful', 'easy', 'normal', 'hard'] },
  'gamemode':                 { label: '默认游戏模式',   desc: '新玩家的默认游戏模式', type: 'enum', options: ['survival', 'creative', 'adventure', 'spectator'] },
  'pvp':                      { label: 'PVP',            desc: '是否允许玩家互相攻击', type: 'bool' },
  'level-name':               { label: '世界名称',       desc: '地图/世界文件夹名称', type: 'string' },
  'level-seed':               { label: '世界种子',       desc: '地图随机种子（留空随机）', type: 'string' },
  'allow-flight':             { label: '允许飞行',       desc: '是否允许玩家飞行', type: 'bool' },
  'hardcore':                 { label: '硬核模式',       desc: '开启后死亡即被服务器封禁', type: 'bool' },
  'white-list':               { label: '白名单',         desc: '是否开启白名单模式', type: 'bool' },
  'enforce-whitelist':        { label: '强制白名单',     desc: '不在白名单中的玩家将被踢出', type: 'bool' },
  'spawn-protection':         { label: '出生点保护',     desc: '出生点保护半径（格）', type: 'number' },
  'view-distance':            { label: '视距',           desc: '服务器发送给客户端的区块距离', type: 'number' },
  'simulation-distance':      { label: '模拟距离',       desc: '服务器模拟的区块距离', type: 'number' },
  'enable-command-block':     { label: '允许命令方块',   desc: '是否启用命令方块', type: 'bool' },
  'enable-query':             { label: '启用查询',       desc: '允许 GameSpy4 查询协议', type: 'bool' },
  'enable-rcon':              { label: '启用远程控制',   desc: '允许 Rcon 远程管理', type: 'bool' },
  'rcon.password':            { label: 'RCON 密码',      desc: '远程控制密码', type: 'string' },
  'rcon.port':                { label: 'RCON 端口',      desc: '远程控制端口', type: 'number' },
  'broadcast-rcon-to-ops':    { label: '广播 RC 操作',   desc: 'RCON 操作是否广播给管理员', type: 'bool' },
  'max-world-size':           { label: '最大世界大小',   desc: '世界边界大小（格）', type: 'number' },
  'network-compression-threshold': { label: '网络压缩阈值', desc: '网络数据包压缩阈值（字节）', type: 'number' },
  'rate-limit':               { label: '速率限制',       desc: '玩家数据包速率限制', type: 'number' },
  'enforce-secure-profile':   { label: '强制安全资料',   desc: '要求玩家有 Mojang 签名', type: 'bool' },
  'prevent-proxy-connections': { label: '禁止代理连接',   desc: '禁止通过代理连接服务器', type: 'bool' },
  'player-idle-timeout':      { label: '闲置超时',       desc: '玩家挂机踢出时间（分钟），0 为不踢', type: 'number' },
  'spawn-animals':            { label: '生成动物',       desc: '是否生成动物', type: 'bool' },
  'spawn-monsters':           { label: '生成怪物',       desc: '是否生成怪物', type: 'bool' },
  'spawn-npcs':               { label: '生成NPC',        desc: '是否生成村民等 NPC', type: 'bool' },
  'generate-structures':      { label: '生成结构',       desc: '是否生成村庄、神殿等结构', type: 'bool' },
  'max-tick-time':            { label: '最大 Tick 时间', desc: '单个 Tick 最大时间（毫秒）', type: 'number' },
  'max-build-height':         { label: '最大建筑高度',   desc: '玩家可建造的最大高度', type: 'number' },
  'op-permission-level':      { label: 'OP 权限等级',    desc: '管理员的默认权限等级 (1-4)', type: 'number' },
  'function-permission-level': { label: '函数权限等级',   desc: '函数的默认权限等级', type: 'number' },
  'entity-broadcast-range-percentage': { label: '实体广播范围', desc: '实体追踪范围百分比', type: 'number' },
  'text-filtering-config':    { label: '文本过滤',       desc: '聊天文本过滤配置', type: 'string' },
}

export function parseProperties(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    map[t.substring(0, eq).trim()] = t.substring(eq + 1).trim()
  }
  return map
}

export function serializeProperties(map: Record<string, string>, originalText: string): string {
  const lines = originalText.split('\n')
  const used = new Set<string>()
  const result = lines.map(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const eq = t.indexOf('=')
    if (eq === -1) return line
    const key = t.substring(0, eq).trim()
    if (key in map) {
      used.add(key)
      return `${key}=${map[key]}`
    }
    return line
  })

  for (const [key, val] of Object.entries(map)) {
    if (!used.has(key)) {
      result.push(`${key}=${val}`)
    }
  }
  return result.join('\n')
}
