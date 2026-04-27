import {
  GameState, BattleState, BASE_PRICE, SHIP_STATUS,
  MONTHS, LOCATIONS, GENERIC,
} from './constants'

export function rnd(n: number): number {
  return Math.floor(Math.random() * n)
}

export function fancyNum(num: number): string {
  const n = Math.floor(Math.abs(num))
  if (n >= 100_000_000) return `${Math.floor(n / 1_000_000)}M`
  if (n >= 10_000_000) {
    const m = Math.floor(n / 1_000_000)
    const d = Math.floor((n % 1_000_000) / 100_000)
    return d ? `${m}.${d}M` : `${m}M`
  }
  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000)
    const d = Math.floor((n % 1_000_000) / 10_000)
    return d ? `${m}.${d}M` : `${m}M`
  }
  return n.toLocaleString()
}

export function setPrices(gs: GameState): void {
  for (let i = 0; i < 4; i++) {
    gs.price[i] =
      Math.floor(BASE_PRICE[i][gs.port] / 2) *
      (rnd(3) + 1) *
      BASE_PRICE[i][0]
  }
}

export function getTime(gs: GameState): number {
  return (gs.year - 1860) * 12 + gs.month
}

export function statusPct(gs: GameState): number {
  return Math.max(0, 100 - Math.floor((gs.damage / gs.capacity) * 100))
}

export function statusText(gs: GameState): string {
  const pct = statusPct(gs)
  const idx = Math.min(5, Math.floor(pct / 20))
  return `${SHIP_STATUS[idx]} (${pct}%)`
}

export function dateStr(gs: GameState): string {
  return `${MONTHS[gs.month - 1]} ${gs.year}`
}

export function portName(gs: GameState): string {
  return LOCATIONS[gs.port]
}

export function warehouseTotal(gs: GameState): number {
  return gs.hkw[0] + gs.hkw[1] + gs.hkw[2] + gs.hkw[3]
}

// ─── Battle ───────────────────────────────────────────────────────────────

export function initBattle(numShips: number, id: number, ec: number): BattleState {
  const visible = Math.min(numShips, 10)
  const shipHealth = Array.from({ length: visible }, () =>
    Math.floor(ec * Math.random() + 20),
  )
  return { numShips, s0: numShips, id, ok: 0, ik: 1, shipHealth }
}

function refillVisible(bs: BattleState, ec: number): void {
  while (bs.shipHealth.length < Math.min(bs.numShips, 10)) {
    bs.shipHealth.push(Math.floor(ec * Math.random() + 20))
  }
}

export function battleFire(
  gs: GameState,
  bs: BattleState,
): { sunk: number; enemiesFled: number } {
  refillVisible(bs, gs.ec)
  let sunk = 0

  for (let g = 0; g < gs.guns && bs.numShips > 0; g++) {
    if (bs.shipHealth.length === 0) break
    const target = rnd(bs.shipHealth.length)
    const dmg = rnd(30) + 10
    bs.shipHealth[target] -= dmg
    if (bs.shipHealth[target] <= 0) {
      bs.shipHealth.splice(target, 1)
      bs.numShips--
      sunk++
      refillVisible(bs, gs.ec)
    }
  }

  bs.ok = 3
  bs.ik = 1

  // Some enemy ships flee after our volley
  let enemiesFled = 0
  if (
    bs.numShips > 2 &&
    rnd(bs.s0) > Math.floor(bs.numShips * 0.6 / bs.id)
  ) {
    enemiesFled = rnd(Math.max(1, Math.floor(bs.numShips / 3 / bs.id))) + 1
    bs.numShips = Math.max(0, bs.numShips - enemiesFled)
    const remove = Math.min(enemiesFled, bs.shipHealth.length)
    bs.shipHealth.splice(0, remove)
  }

  return { sunk, enemiesFled }
}

export function battleRun(
  bs: BattleState,
): { escaped: boolean; lostShips: number } {
  bs.ok += bs.ik++
  if (rnd(bs.ok) > rnd(bs.numShips)) {
    bs.numShips = 0
    bs.shipHealth = []
    return { escaped: true, lostShips: 0 }
  }
  let lostShips = 0
  if (bs.numShips > 2 && rnd(5) === 0) {
    lostShips = rnd(Math.floor(bs.numShips / 2)) + 1
    bs.numShips = Math.max(0, bs.numShips - lostShips)
    const remove = Math.min(lostShips, bs.shipHealth.length)
    bs.shipHealth.splice(0, remove)
  }
  return { escaped: false, lostShips }
}

export function battleThrow(
  gs: GameState,
  bs: BattleState,
  itemIdx: number, // 0-3 = specific item, 4 = all
): number {
  let total = 0
  if (itemIdx < 4) {
    total = gs.hold_[itemIdx]
    gs.hold_[itemIdx] = 0
    gs.hold += total
  } else {
    for (let i = 0; i < 4; i++) {
      total += gs.hold_[i]
      gs.hold_[i] = 0
    }
    gs.hold += total
  }
  bs.ok += Math.floor(total / 10)
  bs.ik = 1
  return total
}

export function battleEnemyFire(
  gs: GameState,
  bs: BattleState,
): { lostGun: boolean; sunk: boolean } {
  const i = Math.min(bs.numShips, 15)
  let lostGun = false

  const damRatio = gs.damage / gs.capacity
  if (gs.guns > 0 && (Math.random() * 100 < damRatio * 100 || damRatio > 0.8)) {
    gs.guns--
    gs.hold += 10
    lostGun = true
  }

  gs.damage += Math.floor(gs.ed * i * bs.id * Math.random() + i / 2)

  // Li Yuen save chance (only for generic pirates)
  if (bs.id === GENERIC && rnd(20) === 0) {
    return { lostGun, sunk: false } // signal: li yuen saves (caller checks numShips)
    // we abuse "sunk: false" here — caller handles the li_yuen_saved result
  }

  return { lostGun, sunk: statusPct(gs) <= 0 }
}

export function battleLiYuenSave(bs: BattleState): boolean {
  // Called after enemy fire to check if Li Yuen intervenes
  return bs.id === GENERIC && rnd(20) === 0
}

// ─── Port events ──────────────────────────────────────────────────────────

export function computeLiYuenAmount(gs: GameState): number {
  const time = getTime(gs)
  let i = 1.8
  let j = 0
  if (time > 12) {
    j = rnd(1000 * time) + 1000 * time
    i = 1
  }
  return Math.floor((gs.cash / i) * Math.random() + j)
}

export function computeRepairPrice(gs: GameState): { br: number; repairPrice: number } {
  const time = getTime(gs)
  const br = Math.floor(
    ((60 * (time + 3) / 4 * Math.random()) + 25 * (time + 3) / 4) *
    gs.capacity / 50,
  )
  const repairPrice = br * gs.damage + 1
  return { br, repairPrice }
}

export function applyRepair(gs: GameState, spent: number, br: number): void {
  gs.cash -= spent
  gs.damage -= Math.floor(spent / br + 0.5)
  gs.damage = Math.max(0, gs.damage)
}

export function computeNewShipCost(gs: GameState): number {
  const time = getTime(gs)
  return rnd(1000 * (time + 5) / 6) * (gs.capacity / 50) + 1000
}

export function computeNewGunCost(gs: GameState): number {
  const time = getTime(gs)
  return rnd(1000 * (time + 5) / 6) + 500
}

export function computeBooty(gs: GameState, numShips: number): number {
  const time = getTime(gs)
  return Math.floor(time / 4 * 1000 * numShips) + rnd(1000) + 250
}

export function advanceMonth(gs: GameState): void {
  gs.month++
  if (gs.month === 13) {
    gs.month = 1
    gs.year++
    gs.ec += 10
    gs.ed += 0.5
  }
  gs.debt = gs.debt + gs.debt * 0.1
  gs.bank = gs.bank + gs.bank * 0.005
}

export function computeFinalScore(gs: GameState): number {
  const time = getTime(gs)
  const net = gs.cash + gs.bank - gs.debt
  return Math.floor(net / 100 / time)
}

export function getRating(score: number): string {
  if (score >= 50000) return 'Ma Tsu'
  if (score >= 8000) return 'Master Taipan'
  if (score >= 1000) return 'Taipan'
  if (score >= 500) return 'Compradore'
  return 'Galley Hand'
}

// ─── Display helpers ──────────────────────────────────────────────────────

// Format numbers with k/M suffix to save space (5000 → 5k, 10000 → 10k)
export function fancyK(n: number): string {
  const abs = Math.abs(Math.floor(n))
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000
    return `${m.toFixed(1)}M`
  }
  if (abs >= 1_000) {
    const k = abs / 1_000
    return `${k.toFixed(1)}k`
  }
  return `${abs}`
}

export function drawShips(n: number): string {
  if (n <= 0) return '  (all sunk)'
  const shown = Math.min(n, 10)
  const row1 = Math.min(shown, 5)
  const row2 = shown - row1
  const extra = n - shown
  let s = Array(row1).fill('▲').join(' ')
  if (row2 > 0) s += '\n  ' + Array(row2).fill('▲').join(' ')
  if (extra > 0) s += `  +${extra}`
  return '  ' + s
}

export function formatPortHeader(gs: GameState): string {
  const lines: string[] = []

  // Line 1: port + date
  lines.push(`${portName(gs)}  ${dateStr(gs)}`)

  // Line 2: warehouse — Hong Kong only
  if (gs.port === 1) {
    const used = warehouseTotal(gs)
    lines.push(
      `WH(${fancyK(used)}/10k): O:${gs.hkw[0]} S:${gs.hkw[1]} A:${gs.hkw[2]} G:${gs.hkw[3]}`,
    )
  }

  // Line 3: ship hold
  const holdLabel = gs.hold < 0
    ? `OVER+${Math.abs(gs.hold)}`
    : `free:${gs.hold}`
  lines.push(
    `Hold(${holdLabel}): O:${gs.hold_[0]} S:${gs.hold_[1]} A:${gs.hold_[2]} G:${gs.hold_[3]}`,
  )

  // Line 4: finances
  if (gs.port === 1) {
    lines.push(
      `$${fancyK(gs.cash)} Bnk:${fancyK(gs.bank)} Dbt:${fancyK(gs.debt)} Guns:${gs.guns}`,
    )
  } else {
    lines.push(`$${fancyK(gs.cash)} Dbt:${fancyK(gs.debt)} Guns:${gs.guns}`)
  }

  // Line 5: ship status
  lines.push(statusText(gs))

  return lines.join('\n')
}

// Compact single-line price display with k notation
export function formatPrices(gs: GameState): string {
  return (
    `O:$${fancyK(gs.price[0])} S:$${fancyK(gs.price[1])}` +
    ` A:$${fancyK(gs.price[2])} G:$${fancyK(gs.price[3])}`
  )
}

export function qtyOptions(max: number, label: string): string[] {
  const opts: string[] = []
  if (max > 0) opts.push(`All (${max} ${label})`)
  if (max >= 4) opts.push(`¾ (${Math.floor(max * 0.75)} ${label})`)
  if (max >= 2) opts.push(`½ (${Math.floor(max / 2)} ${label})`)
  if (max >= 4) opts.push(`¼ (${Math.floor(max / 4)} ${label})`)
  if (max >= 10) opts.push(`10 ${label}`)
  if (max >= 1) opts.push(`1 ${label}`)
  opts.push('Cancel')
  return opts
}

export function qtyFromIndex(idx: number, max: number, opts: string[]): number {
  const label = opts[idx]
  if (!label || label === 'Cancel') return 0
  if (label.startsWith('All')) return max
  if (label.startsWith('¾')) return Math.floor(max * 0.75)
  if (label.startsWith('½')) return Math.floor(max / 2)
  if (label.startsWith('¼')) return Math.floor(max / 4)
  if (label.startsWith('10')) return 10
  if (label.startsWith('1 ')) return 1
  return 0
}
