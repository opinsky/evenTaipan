export const ITEMS = ['Opium', 'Silk', 'Arms', 'General'] as const
export type ItemIdx = 0 | 1 | 2 | 3

export const LOCATIONS = [
  'At sea', 'Hong Kong', 'Shanghai', 'Nagasaki',
  'Saigon', 'Manila', 'Singapore', 'Batavia',
] as const

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

export const SHIP_STATUS = [
  'Critical', 'Poor', 'Fair', 'Good', 'Prime', 'Perfect',
] as const

// BASE_PRICE[item][0] = unit value, [1..7] = port multiplier
export const BASE_PRICE = [
  [1000, 11, 16, 15, 14, 12, 10, 13],
  [100,  11, 14, 15, 16, 10, 13, 12],
  [10,   12, 16, 10, 11, 13, 14, 15],
  [1,    10, 11, 12, 13, 14, 15, 16],
] as const

export const PRESET_FIRMS = [
  'Jade Dragon', 'Canton Trade', 'Pearl River',
  'East Wind Co', 'Golden Phoenix', 'Silk Road',
  'Dragon & Sons', 'Harbor Masters', 'Lucky Fortune', 'Rising Sun',
]

export const GENERIC = 1
export const LI_YUEN_ID = 2

export interface GameState {
  firm: string
  cash: number
  bank: number
  debt: number
  booty: number
  ec: number        // enemy capacity (ship health factor)
  ed: number        // enemy damage factor
  price: [number, number, number, number]
  hkw: [number, number, number, number]    // hong kong warehouse
  hold_: [number, number, number, number]  // ship hold contents
  hold: number      // free hold space
  capacity: number
  guns: number
  bp: number        // battle probability denominator (lower = more battles)
  damage: number
  month: number
  year: number
  li: number        // 0=enemy, 1=ally, 2-3=cooldown
  port: number      // 1=HK, 2-7 = other ports
  wu_warn: number
  wu_bailout: number
}

export interface BattleState {
  numShips: number
  s0: number          // initial ship count
  id: number          // GENERIC=1, LI_YUEN_ID=2
  ok: number          // escape/fight accumulator
  ik: number          // escape increment
  shipHealth: number[] // health of visible ships (up to 10)
}

export type BattleResult = 'won' | 'li_yuen_saved' | 'ran' | 'sunk'

export function createInitialState(): GameState {
  return {
    firm: 'Jade Dragon',
    cash: 0, bank: 0, debt: 0, booty: 0,
    ec: 20, ed: 0.5,
    price: [0, 0, 0, 0],
    hkw: [0, 0, 0, 0],
    hold_: [0, 0, 0, 0],
    hold: 0, capacity: 60, guns: 0, bp: 10,
    damage: 0, month: 1, year: 1860,
    li: 0, port: 1, wu_warn: 0, wu_bailout: 0,
  }
}
