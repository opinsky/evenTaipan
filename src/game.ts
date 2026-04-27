import { Display } from './display'
import {
  GameState, BattleState, BattleResult,
  ITEMS, LOCATIONS, PRESET_FIRMS,
  GENERIC, LI_YUEN_ID,
  createInitialState,
} from './constants'
import {
  rnd, fancyNum, fancyK, setPrices, statusPct, statusText,
  portName, warehouseTotal, drawShips, formatPortHeader, formatPrices,
  initBattle, battleFire, battleRun, battleThrow, battleEnemyFire,
  battleLiYuenSave, computeLiYuenAmount, computeRepairPrice, applyRepair,
  computeNewShipCost, computeNewGunCost, computeBooty,
  advanceMonth, computeFinalScore, getRating, qtyOptions, qtyFromIndex,
} from './logic'

const SPLASH = 'T  A  I  P  A  N\nChina Trade, 1860\n\nTap to begin your journey'

export class Game {
  private gs: GameState
  private display: Display
  private onStateChange?: (gs: GameState) => void

  constructor(display: Display, onStateChange?: (gs: GameState) => void) {
    this.gs = createInitialState()
    this.display = display
    this.onStateChange = onStateChange
  }

  private emit(): void {
    this.onStateChange?.(this.gs)
  }

  // ─── Entry point ────────────────────────────────────────────────────────

  async run(): Promise<void> {
    while (true) {
      await this.display.showText(SPLASH)
      await this.pickFirm()
      await this.pickStart()
      setPrices(this.gs)
      this.emit()
      await this.portLoop()
      // portLoop only returns when the game ends (final_stats called restart)
    }
  }

  // ─── Setup ──────────────────────────────────────────────────────────────

  private async pickFirm(): Promise<void> {
    const header = 'Choose your trading firm name:'
    const idx = await this.display.showMenu(header, PRESET_FIRMS, 60)
    this.gs.firm = idx >= 0 ? PRESET_FIRMS[idx] : PRESET_FIRMS[0]
  }

  private async pickStart(): Promise<void> {
    const header = 'Choose starting conditions:'
    const items = [
      '$400 cash + $5,000 debt',
      '5 guns, no debt (no cash)',
    ]
    const idx = await this.display.showMenu(header, items, 60)
    if (idx === 0 || idx < 0) {
      this.gs.cash = 400; this.gs.debt = 5000
      this.gs.hold = 60; this.gs.guns = 0
      this.gs.li = 0; this.gs.bp = 10
    } else {
      this.gs.cash = 0; this.gs.debt = 0
      this.gs.hold = 10; this.gs.guns = 5
      this.gs.li = 1; this.gs.bp = 7
    }
  }

  // ─── Main port loop ──────────────────────────────────────────────────────

  private async portLoop(): Promise<void> {
    while (true) {
      await this.processPortEvents()

      // Trading menu loop
      let sailing = false
      while (!sailing) {
        const action = await this.showPortMenu()
        if (action === 'buy') await this.doBuy()
        else if (action === 'sell') await this.doSell()
        else if (action === 'bank') await this.doBank()
        else if (action === 'transfer') await this.doTransfer()
        else if (action === 'retire') {
          await this.doRetire()
          return  // game over → restart
        } else if (action === 'quit') {
          if (this.gs.hold < 0) {
            await this.display.showText(
              'Comprador\'s Report\n\n' +
              '⚠ Your ship is overloaded!\n\n' +
              `Hold is ${Math.abs(this.gs.hold)} units over capacity.\n` +
              'Sell cargo before sailing.\n\n' +
              'Tap to continue.',
            )
          } else {
            sailing = true
          }
        }
        this.emit()
      }

      const gameOver = await this.doTravel()
      if (gameOver) return
    }
  }

  // ─── Random port events ──────────────────────────────────────────────────

  private async processPortEvents(): Promise<void> {
    const gs = this.gs

    // Li Yuen extortion (Hong Kong only, first visit of each cycle)
    if (gs.port === 1 && gs.li === 0 && gs.cash > 0) {
      await this.doLiYuenExtortion()
    }

    // McHenry ship repair (Hong Kong only)
    if (gs.port === 1 && gs.damage > 0) {
      await this.doMcHenry()
    }

    // Elder Brother Wu warning (first time debt >= 10000)
    if (gs.port === 1 && gs.debt >= 10000 && gs.wu_warn === 0) {
      const braves = rnd(100) + 50
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        `Elder Brother Wu has sent ${braves} braves\n` +
        'to escort you to the Wu mansion, Taipan.\n\n' +
        'He reminds you of the Confucian ideal\n' +
        'of personal worthiness, and how this\n' +
        'applies to paying one\'s debts.\n\n' +
        'Tap to continue.',
      )
      gs.wu_warn = 1
    }

    // Elder Brother Wu meeting (Hong Kong only)
    if (gs.port === 1) {
      await this.doWu()
    }

    // Random: offer new ship or gun
    if (rnd(4) === 0) {
      if (rnd(2) === 0) await this.offerNewShip()
      else if (gs.guns < 1000) await this.offerNewGun()
    }

    // Random: opium seized (not Hong Kong)
    if (gs.port !== 1 && rnd(18) === 0 && gs.hold_[0] > 0) {
      const fine = Math.floor((gs.cash / 1.8) * Math.random() + 1)
      gs.hold += gs.hold_[0]
      gs.hold_[0] = 0
      gs.cash -= fine
      this.emit()
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        'Bad Joss!!\n\n' +
        'The local authorities have seized your\n' +
        'Opium cargo and have also fined you\n' +
        `$${fancyNum(fine)}, Taipan!\n\n` +
        'Tap to continue.',
      )
    }

    // Random: warehouse theft
    const whTotal = warehouseTotal(gs)
    if (rnd(50) === 0 && whTotal > 0) {
      for (let i = 0; i < 4; i++) {
        gs.hkw[i] = Math.floor(gs.hkw[i] / 1.8 * Math.random())
      }
      this.emit()
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        'Messenger reports large theft\n' +
        'from warehouse, Taipan.\n\n' +
        'Tap to continue.',
      )
    }

    // Li Yuen status update
    if (rnd(20) === 0) {
      if (gs.li > 0) gs.li++
      if (gs.li === 4) gs.li = 0
    }

    // Li Yuen message (not at Hong Kong, when not allied)
    if (gs.port !== 1 && gs.li === 0 && rnd(4) !== 0) {
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        'Li Yuen has sent a Lieutenant,\n' +
        'Taipan. He says his admiral wishes\n' +
        'to see you in Hong Kong, posthaste!\n\n' +
        'Tap to continue.',
      )
    }

    // Good prices event
    if (rnd(9) === 0) {
      await this.doGoodPrices()
    }

    // Robbery
    if (gs.cash > 25000 && rnd(20) === 0) {
      const robbed = Math.floor((gs.cash / 1.4) * Math.random())
      gs.cash -= robbed
      this.emit()
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        'Bad Joss!!\n\n' +
        'You\'ve been beaten up and robbed of\n' +
        `$${fancyNum(robbed)} in cash, Taipan!!\n\n` +
        'Tap to continue.',
      )
    }
  }

  // ─── Li Yuen extortion ───────────────────────────────────────────────────

  private async doLiYuenExtortion(): Promise<void> {
    const gs = this.gs
    const amount = computeLiYuenAmount(gs)

    const header =
      'Comprador\'s Report\n\n' +
      `Li Yuen asks $${fancyNum(amount)} donation\n` +
      'to the Temple of Tin Hau, the Sea\n' +
      'Goddess. Will you pay?'

    const yes = await this.display.askYesNo(header)

    if (yes) {
      if (amount <= gs.cash) {
        gs.cash -= amount
        gs.li = 1
      } else {
        await this.display.showText(
          'You do not have enough cash!!\n\n' +
          'Tap to continue.',
        )
        const wuCover = await this.display.askYesNo(
          'Elder Brother Wu can make up the\n' +
          'difference. Should he pay?',
        )
        if (wuCover) {
          gs.debt += amount - gs.cash
          gs.cash = 0
          gs.li = 1
          await this.display.showText(
            'Elder Brother Wu has paid Li Yuen\n' +
            'the difference and added it to\n' +
            'your debt.\n\nTap to continue.',
          )
        } else {
          gs.cash = 0
          await this.display.showText(
            'Very well. I would be very wary\n' +
            'of pirates if I were you, Taipan.\n\nTap to continue.',
          )
        }
      }
    }

    this.emit()
  }

  // ─── McHenry ship repair ─────────────────────────────────────────────────

  private async doMcHenry(): Promise<void> {
    const gs = this.gs
    const pct = 100 - Math.floor((gs.damage / gs.capacity) * 100)

    const yes = await this.display.askYesNo(
      'Comprador\'s Report\n\n' +
      'Mc Henry from the Hong Kong Shipyards\n' +
      `says: "Ye\'ve ${pct}% damage, Taipan.\n` +
      'Will ye be wanting repairs?"',
    )

    if (!yes) return

    const { br, repairPrice } = computeRepairPrice(gs)
    const canAfford = Math.min(gs.cash, repairPrice)
    const opts = [
      `Full repair ($${fancyNum(repairPrice)})`,
      `½ repair ($${fancyNum(Math.floor(repairPrice / 2))})`,
      `¼ repair ($${fancyNum(Math.floor(repairPrice / 4))})`,
      'No repair',
    ]

    const header =
      `Och, \'tis a pity to be ${pct}% damaged.\n` +
      `Full repair: $${fancyNum(repairPrice)}\n` +
      `You have: $${fancyNum(gs.cash)}\n` +
      `How much to spend?`

    const idx = await this.display.showMenu(header, opts, 100)

    let spend = 0
    if (idx === 0) spend = Math.min(canAfford, repairPrice)
    else if (idx === 1) spend = Math.min(gs.cash, Math.floor(repairPrice / 2))
    else if (idx === 2) spend = Math.min(gs.cash, Math.floor(repairPrice / 4))

    if (spend > 0) {
      applyRepair(gs, spend, br)
      await this.display.showText(
        `Spent $${fancyNum(spend)} on repairs.\n` +
        `Ship is now: ${statusText(gs)}\n\nTap to continue.`,
      )
    }

    this.emit()
  }

  // ─── Elder Brother Wu ─────────────────────────────────────────────────────

  private async doWu(): Promise<void> {
    const gs = this.gs

    const wantBusiness = await this.display.askYesNo(
      'Comprador\'s Report\n\n' +
      'Do you have business with Elder\n' +
      'Brother Wu, the moneylender?',
    )

    if (!wantBusiness) {
      await this.checkWuRobbery()
      return
    }

    // Check if player is completely broke (bailout scenario)
    const totally_broke =
      Math.floor(gs.cash) === 0 && Math.floor(gs.bank) === 0 &&
      gs.guns === 0 &&
      gs.hold_[0] === 0 && gs.hkw[0] === 0 &&
      gs.hold_[1] === 0 && gs.hkw[1] === 0 &&
      gs.hold_[2] === 0 && gs.hkw[2] === 0 &&
      gs.hold_[3] === 0 && gs.hkw[3] === 0

    if (totally_broke) {
      await this.doWuBailout()
      return
    }

    // Repay debt
    if (gs.cash > 0 && gs.debt > 0) {
      await this.doWuRepay()
    }

    // Borrow more
    await this.doWuBorrow()

    await this.checkWuRobbery()
  }

  private async doWuBailout(): Promise<void> {
    const gs = this.gs
    gs.wu_bailout++
    const loan = rnd(1500) + 500
    const repay = rnd(2000) * gs.wu_bailout + 1500

    const accept = await this.display.askYesNo(
      'Comprador\'s Report\n\n' +
      'Elder Brother Wu is aware of your\n' +
      `plight. He will loan you $${loan}\n` +
      `if you repay $${repay}.\n` +
      'Do you accept?',
    )

    if (!accept) {
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        'Very well, Taipan, the game is over!\n\nTap to continue.',
      )
      await this.doFinalStats()
    } else {
      gs.cash += loan
      gs.debt += repay
      this.emit()
      await this.display.showText(
        'Very well, Taipan. Good joss!!\n\nTap to continue.',
      )
    }
  }

  private async doWuRepay(): Promise<void> {
    const gs = this.gs
    const opts = qtyOptions(Math.floor(gs.cash), 'in cash')
    const header =
      `Debt: $${fancyNum(gs.debt)}\n` +
      `Cash: $${fancyNum(gs.cash)}\n` +
      'How much to repay Elder Brother Wu?'

    const idx = await this.display.showMenu(header, opts, 80)
    const amount = qtyFromIndex(idx, Math.floor(gs.cash), opts)

    if (amount > 0) {
      gs.cash -= amount
      gs.debt = Math.max(0, gs.debt - amount)
      this.emit()
      await this.display.showText(
        `Repaid $${fancyNum(amount)}.\n` +
        `Remaining debt: $${fancyNum(gs.debt)}\n\nTap to continue.`,
      )
    }
  }

  private async doWuBorrow(): Promise<void> {
    const gs = this.gs
    const maxBorrow = Math.floor(gs.cash * 2)
    if (maxBorrow <= 0) return

    const opts = qtyOptions(maxBorrow, '')
    // Clean up labels
    const cleanOpts = opts.map(o => o.replace('  ', '').trim())
    const header =
      `Max borrow: $${fancyNum(maxBorrow)}\n` +
      '(Elder Brother lends up to 2× cash)\n' +
      'How much to borrow?'

    const idx = await this.display.showMenu(header, cleanOpts, 80)
    const amount = qtyFromIndex(idx, maxBorrow, cleanOpts)

    if (amount > 0) {
      gs.cash += amount
      gs.debt += amount
      this.emit()
      await this.display.showText(
        `Borrowed $${fancyNum(amount)}.\n` +
        `New debt: $${fancyNum(gs.debt)}\n\nTap to continue.`,
      )
    }
  }

  private async checkWuRobbery(): Promise<void> {
    const gs = this.gs
    if (gs.debt > 20000 && gs.cash > 0 && rnd(5) === 0) {
      const num = rnd(3) + 1
      gs.cash = 0
      this.emit()
      await this.display.showText(
        'Comprador\'s Report\n\n' +
        'Bad joss!!\n' +
        `${num} of your bodyguards have been killed\n` +
        'by cutthroats and you have been\n' +
        'robbed of all your cash, Taipan!!\n\nTap to continue.',
      )
    }
  }

  // ─── Good prices ─────────────────────────────────────────────────────────

  private async doGoodPrices(): Promise<void> {
    const gs = this.gs
    const i = rnd(4)
    const rise = rnd(2) === 1
    if (rise) {
      gs.price[i] = gs.price[i] * (rnd(5) + 5)
    } else {
      gs.price[i] = Math.floor(gs.price[i] / 5)
    }
    const change = rise ? 'risen' : 'dropped'
    await this.display.showText(
      'Comprador\'s Report\n\n' +
      `Taipan!! The price of ${ITEMS[i]}\n` +
      `has ${change} to $${gs.price[i].toLocaleString()}!!\n\n` +
      'Tap to continue.',
    )
  }

  // ─── New ship / gun offers ────────────────────────────────────────────────

  private async offerNewShip(): Promise<void> {
    const gs = this.gs
    const amount = computeNewShipCost(gs)
    if (gs.cash < amount) return

    const dmgDesc = gs.damage > 0 ? 'damaged' : 'fine'
    const yes = await this.display.askYesNo(
      'Comprador\'s Report\n\n' +
      `Trade in your ${dmgDesc} ship for\n` +
      'one with 50 more capacity by\n' +
      `paying $${fancyNum(amount)}?`,
    )

    if (yes) {
      gs.cash -= amount
      gs.hold += 50
      gs.capacity += 50
      gs.damage = 0
      this.emit()
      if (rnd(2) === 0 && gs.guns < 1000) {
        await this.offerNewGun()
      }
    }
  }

  private async offerNewGun(): Promise<void> {
    const gs = this.gs
    const amount = computeNewGunCost(gs)
    if (gs.cash < amount || gs.hold < 10) return

    const yes = await this.display.askYesNo(
      'Comprador\'s Report\n\n' +
      'Do you wish to buy a ship\'s gun\n' +
      `for $${fancyNum(amount)}, Taipan?`,
    )

    if (yes) {
      gs.cash -= amount
      gs.hold -= 10
      gs.guns++
      this.emit()
    }
  }

  // ─── Port menu ────────────────────────────────────────────────────────────

  private async showPortMenu(): Promise<string> {
    const gs = this.gs
    const header = formatPortHeader(gs) + '\n' + formatPrices(gs)

    const actions: Array<{ label: string; key: string }> = [
      { label: 'Buy cargo', key: 'buy' },
      { label: 'Sell cargo', key: 'sell' },
    ]
    if (gs.port === 1) {
      actions.push({ label: 'Visit bank', key: 'bank' })
      actions.push({ label: 'Transfer cargo', key: 'transfer' })
    }
    if (gs.port === 1 && gs.cash + gs.bank >= 1_000_000) {
      actions.push({ label: '★ Retire (Millionaire!)', key: 'retire' })
    }
    actions.push({ label: 'Sail to new port', key: 'quit' })

    const idx = await this.display.showMenu(header, actions.map(a => a.label), 168)
    if (idx < 0) return 'quit'
    return actions[Math.min(idx, actions.length - 1)].key
  }

  // ─── Buy ─────────────────────────────────────────────────────────────────

  private async doBuy(): Promise<void> {
    const gs = this.gs

    // Pick item
    const itemOpts = ITEMS.map((it, i) =>
      `${it}  $${fancyK(gs.price[i])}`,
    )
    itemOpts.push('Cancel')
    const itemIdx = await this.display.showMenu('Buy which item?', itemOpts, 50)
    if (itemIdx < 0 || itemIdx >= 4) return

    const price = gs.price[itemIdx]
    const canAfford = Math.min(
      Math.floor(gs.cash / price),
      gs.hold >= 0 ? gs.hold : 0,
    )

    if (canAfford <= 0) {
      await this.display.showText(
        'You cannot afford any, Taipan.\n\nTap to continue.',
      )
      return
    }

    const opts = qtyOptions(canAfford, ITEMS[itemIdx].toLowerCase())
    const header =
      `Buy ${ITEMS[itemIdx]} @ $${fancyK(price)}/unit\n` +
      `Cash: $${fancyK(gs.cash)}  Hold free: ${gs.hold}\n` +
      `Can afford: ${canAfford} units`

    const qIdx = await this.display.showMenu(header, opts, 75)
    const amount = qtyFromIndex(qIdx, canAfford, opts)
    if (amount <= 0) return

    gs.cash -= amount * price
    gs.hold_[itemIdx] += amount
    gs.hold -= amount
    this.emit()
  }

  // ─── Sell ─────────────────────────────────────────────────────────────────

  private async doSell(): Promise<void> {
    const gs = this.gs

    const itemOpts = ITEMS.map((it, i) =>
      `${it}  (${gs.hold_[i]})  $${fancyK(gs.price[i])}`,
    )
    itemOpts.push('Cancel')
    const itemIdx = await this.display.showMenu('Sell which item?', itemOpts, 50)
    if (itemIdx < 0 || itemIdx >= 4) return

    const inHold = gs.hold_[itemIdx]
    if (inHold <= 0) {
      await this.display.showText(
        `No ${ITEMS[itemIdx]} in hold, Taipan.\n\nTap to continue.`,
      )
      return
    }

    const opts = qtyOptions(inHold, ITEMS[itemIdx].toLowerCase())
    const header =
      `Sell ${ITEMS[itemIdx]} @ $${fancyK(gs.price[itemIdx])}/unit\n` +
      `In hold: ${inHold} units`

    const qIdx = await this.display.showMenu(header, opts, 65)
    const amount = qtyFromIndex(qIdx, inHold, opts)
    if (amount <= 0) return

    gs.hold_[itemIdx] -= amount
    gs.cash += amount * gs.price[itemIdx]
    gs.hold += amount
    this.emit()
  }

  // ─── Bank ─────────────────────────────────────────────────────────────────

  private async doBank(): Promise<void> {
    const gs = this.gs

    // Deposit
    if (gs.cash > 0) {
      const depositOpts = qtyOptions(Math.floor(gs.cash), 'in cash')
      const dIdx = await this.display.showMenu(
        `Deposit cash to bank?\nCash: $${fancyNum(gs.cash)}\nBank: $${fancyNum(gs.bank)}`,
        depositOpts, 80,
      )
      const deposit = qtyFromIndex(dIdx, Math.floor(gs.cash), depositOpts)
      if (deposit > 0) {
        gs.cash -= deposit
        gs.bank += deposit
        this.emit()
      }
    }

    // Withdraw
    if (gs.bank > 0) {
      const wdOpts = qtyOptions(Math.floor(gs.bank), 'from bank')
      const wIdx = await this.display.showMenu(
        `Withdraw from bank?\nBank: $${fancyNum(gs.bank)}\nCash: $${fancyNum(gs.cash)}`,
        wdOpts, 80,
      )
      const withdraw = qtyFromIndex(wIdx, Math.floor(gs.bank), wdOpts)
      if (withdraw > 0) {
        gs.bank -= withdraw
        gs.cash += withdraw
        this.emit()
      }
    }
  }

  // ─── Transfer ─────────────────────────────────────────────────────────────

  private async doTransfer(): Promise<void> {
    const gs = this.gs
    const whUsed = warehouseTotal(gs)
    const whFree = 10000 - whUsed

    while (true) {
      const menuItems = ITEMS.map((it, i) =>
        `${it}: Ship(${gs.hold_[i]}) WH(${gs.hkw[i]})`,
      )
      menuItems.push('Done')

      const header =
        `Warehouse: ${whUsed}/10000 used\n` +
        `Ship hold free: ${gs.hold}\n` +
        'Pick item to transfer:'

      const itemIdx = await this.display.showMenu(header, menuItems, 80)
      if (itemIdx < 0 || itemIdx >= 4) break

      const item = ITEMS[itemIdx]
      const inShip = gs.hold_[itemIdx]
      const inWh = gs.hkw[itemIdx]

      if (inShip === 0 && inWh === 0) {
        await this.display.showText(`No ${item} to transfer.\n\nTap to continue.`)
        continue
      }

      const dirItems = ['To Warehouse', 'To Ship', 'Cancel']
      const dirIdx = await this.display.showMenu(
        `Transfer ${item}:\n  Ship: ${inShip} units\n  Warehouse: ${inWh} units`,
        dirItems, 70,
      )

      if (dirIdx === 0 && inShip > 0) {
        // Ship → Warehouse
        const maxMove = Math.min(inShip, whFree)
        if (maxMove <= 0) {
          await this.display.showText('Warehouse is full, Taipan!\n\nTap to continue.')
          continue
        }
        const opts = qtyOptions(maxMove, item.toLowerCase())
        const qIdx = await this.display.showMenu(
          `Move ${item} to warehouse\nMax: ${maxMove} units`, opts, 60,
        )
        const amount = qtyFromIndex(qIdx, maxMove, opts)
        if (amount > 0) {
          gs.hold_[itemIdx] -= amount
          gs.hkw[itemIdx] += amount
          gs.hold += amount
        }
      } else if (dirIdx === 1 && inWh > 0) {
        // Warehouse → Ship
        const opts = qtyOptions(inWh, item.toLowerCase())
        const qIdx = await this.display.showMenu(
          `Move ${item} to ship\nIn warehouse: ${inWh} units`, opts, 60,
        )
        const amount = qtyFromIndex(qIdx, inWh, opts)
        if (amount > 0) {
          gs.hkw[itemIdx] -= amount
          gs.hold_[itemIdx] += amount
          gs.hold -= amount
        }
      }

      this.emit()
    }
  }

  // ─── Travel (quit port, sea battles, arrive) ──────────────────────────────

  private async doTravel(): Promise<boolean> {
    const gs = this.gs

    // Pick destination
    const ports = LOCATIONS.slice(1).map((name, i) => {
      const portNum = i + 1
      return portNum === gs.port ? null : name
    }).filter(Boolean) as string[]

    const portNums = LOCATIONS.slice(1)
      .map((_, i) => i + 1)
      .filter(n => n !== gs.port)

    const destIdx = await this.display.showMenu(
      'Comprador\'s Report\n\nWhere shall we sail, Taipan?',
      ports, 60,
    )

    if (destIdx < 0) return false
    gs.port = portNums[destIdx]

    // Show "at sea"
    await this.display.showText(
      `Captain's Report\n\nSailing to ${portName(gs)}...\n\nTap to continue.`,
    )

    // Generic pirate encounter
    let result: BattleResult = 'ran'  // default: no battle
    let hadBattle = false

    if (rnd(gs.bp) === 0) {
      const numShips = Math.min(
        rnd(Math.floor(gs.capacity / 10) + gs.guns) + 1,
        9999,
      )
      await this.display.showText(
        `Captain's Report\n\n` +
        `${numShips} hostile ship${numShips !== 1 ? 's' : ''} approaching,\n` +
        'Taipan!\n\nTap to prepare for battle.',
      )
      gs.booty = computeBooty(gs, numShips)
      result = await this.runSeaBattle(GENERIC, numShips)
      hadBattle = true
    }

    if (result === 'sunk') {
      await this.display.showText(
        'Captain\'s Report\n\n' +
        'The buggers got us, Taipan!!!\n' +
        'It\'s all over, now!!!\n\nTap to continue.',
      )
      await this.doFinalStats()
      return true
    }

    if (result === 'li_yuen_saved') {
      await this.display.showText(
        'Captain\'s Report\n\n' +
        'Li Yuen\'s fleet drove them off!\n\nTap to continue.',
      )
    }

    // Li Yuen pirate encounter
    const liYuenCheck =
      (!hadBattle && rnd(4 + 8 * gs.li) === 0) ||
      result === 'li_yuen_saved'

    if (liYuenCheck) {
      await this.display.showText(
        'Captain\'s Report\n\n' +
        'Li Yuen\'s pirates, Taipan!!\n\nTap to continue.',
      )

      if (gs.li > 0) {
        await this.display.showText(
          'Good joss!! They let us be!!\n\nTap to continue.',
        )
      } else {
        const lyShips = rnd(Math.floor(gs.capacity / 5) + gs.guns) + 5
        await this.display.showText(
          `Captain's Report\n\n` +
          `${lyShips} ships of Li Yuen's pirate\n` +
          'fleet, Taipan!!\n\nTap to prepare for battle.',
        )
        gs.booty = computeBooty(gs, lyShips)
        const lyResult = await this.runSeaBattle(LI_YUEN_ID, lyShips)
        if (lyResult === 'sunk') {
          await this.display.showText(
            'The buggers got us, Taipan!!!\n' +
            'It\'s all over, now!!!\n\nTap to continue.',
          )
          await this.doFinalStats()
          return true
        }
      }
    }

    // Show battle outcome
    if (result === 'won') {
      await this.display.showText(
        'Captain\'s Report\n\n' +
        'We captured some booty.\n' +
        `It\'s worth $${fancyNum(gs.booty)}!\n\nTap to continue.`,
      )
      gs.cash += gs.booty
    } else if (result === 'ran') {
      await this.display.showText(
        'Captain\'s Report\n\nWe made it!\n\nTap to continue.',
      )
    }

    // Random storm
    if (rnd(10) === 0) {
      await this.display.showText(
        'Captain\'s Report\n\nStorm, Taipan!!\n\nTap to continue.',
      )

      if (rnd(30) === 0) {
        await this.display.showText(
          'I think we\'re going down!!\n\nTap to continue.',
        )
        const damRatio = gs.damage / gs.capacity * 3
        if (damRatio * Math.random() >= 1) {
          await this.display.showText(
            'We\'re going down, Taipan!!\n\nTap to continue.',
          )
          await this.doFinalStats()
          return true
        }
      }

      await this.display.showText(
        'We made it!!\n\nTap to continue.',
      )

      if (rnd(3) === 0) {
        const orig = gs.port
        while (gs.port === orig) {
          gs.port = rnd(7) + 1
        }
        await this.display.showText(
          `We've been blown off course\nto ${portName(gs)}!\n\nTap to continue.`,
        )
      }
    }

    // Advance time and update economy
    advanceMonth(gs)
    setPrices(gs)
    this.emit()

    await this.display.showText(
      `Arriving at ${portName(gs)}...\n\nTap to continue.`,
    )

    return false
  }

  // ─── Sea battle ───────────────────────────────────────────────────────────

  private async runSeaBattle(id: number, numShips: number): Promise<BattleResult> {
    const gs = this.gs
    const bs = initBattle(numShips, id, gs.ec)

    while (bs.numShips > 0) {
      if (statusPct(gs) <= 0) return 'sunk'

      const battleHeader = this.buildBattleHeader(bs, gs)
      const actionItems = gs.guns > 0
        ? ['⚔ Fight', '⚡ Run', '◈ Throw Cargo']
        : ['⚡ Run', '◈ Throw Cargo']

      const idx = await this.display.showMenu(battleHeader, actionItems, 155)

      // Map index to action (account for no-guns case)
      let action: 'fight' | 'run' | 'throw'
      if (gs.guns > 0) {
        if (idx === 0 || idx < 0) action = 'fight'
        else if (idx === 1) action = 'run'
        else action = 'throw'
      } else {
        if (idx === 0 || idx < 0) action = 'run'
        else action = 'throw'
      }

      if (action === 'fight') {
        if (gs.guns === 0) {
          await this.display.showText('We have no guns, Taipan!!\n\nTap to continue.')
        } else {
          const { sunk, enemiesFled } = battleFire(gs, bs)
          let msg = `Captain's Report\n\nWe're firing on 'em!\n`
          if (sunk > 0) msg += `Sunk ${sunk} of the buggers!\n`
          else msg += "Hit 'em, but no sinks.\n"
          if (enemiesFled > 0) msg += `${enemiesFled} ran away!\n`
          msg += `\n${bs.numShips} ships remain.\nTap to continue.`
          await this.display.showText(msg)
        }
      } else if (action === 'run') {
        const { escaped, lostShips } = battleRun(bs)
        if (escaped) {
          await this.display.showText("We got away from 'em, Taipan!\n\nTap to continue.")
          return 'ran'
        }
        let msg = "Couldn't lose 'em."
        if (lostShips > 0) msg += `\nBut escaped from ${lostShips}!`
        msg += '\n\nTap to continue.'
        await this.display.showText(msg)
      } else {
        // Throw cargo
        const throwItems = ITEMS.map((it, i) =>
          `${it} (${gs.hold_[i]} units)`,
        )
        throwItems.push('ALL cargo')
        throwItems.push('Cancel')

        const tIdx = await this.display.showMenu(
          'What to throw overboard?', throwItems, 40,
        )

        if (tIdx >= 0 && tIdx < throwItems.length - 1) {
          const thrown = battleThrow(gs, bs, tIdx < 4 ? tIdx : 4)
          await this.display.showText(
            `Threw ${thrown} units overboard.\n` +
            "Let's hope we lose 'em!\n\nTap to continue.",
          )
        }
      }

      if (bs.numShips <= 0) break

      // Enemy fires back
      await this.display.showText(
        "They're firing on us, Taipan!\n\nTap to continue.",
      )

      // Check Li Yuen saves (generic only)
      if (battleLiYuenSave(bs)) {
        return 'li_yuen_saved'
      }

      const { lostGun, sunk } = battleEnemyFire(gs, bs)
      this.emit()

      let damMsg = "We've been hit, Taipan!!\n"
      if (lostGun) damMsg += 'A gun was destroyed!\n'
      damMsg += `Ship: ${statusText(gs)}\n\nTap to continue.`
      await this.display.showText(damMsg)

      if (sunk) return 'sunk'
    }

    return 'won'
  }

  private buildBattleHeader(bs: BattleState, gs: GameState): string {
    const shipWord = bs.numShips === 1 ? 'ship' : 'ships'
    const typeStr = bs.id === GENERIC ? 'PIRATES' : 'LI YUEN'
    const lines = [
      `⚔ ${bs.numShips} ${typeStr} ${shipWord} ⚔`,
      drawShips(bs.numShips),
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Guns: ${gs.guns}   Ship: ${statusText(gs)}`,
    ]
    return lines.join('\n')
  }

  // ─── Retire ───────────────────────────────────────────────────────────────

  private async doRetire(): Promise<void> {
    await this.display.showText(
      'Comprador\'s Report\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '  Y o u \'r e   a\n' +
      '\n' +
      '  M I L L I O N A I R E !\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      'Tap to see final results.',
    )
    await this.doFinalStats()
  }

  // ─── Final stats ──────────────────────────────────────────────────────────

  private async doFinalStats(): Promise<void> {
    const gs = this.gs
    const years = gs.year - 1860
    const net = gs.cash + gs.bank - gs.debt
    const score = computeFinalScore(gs)
    const rating = getRating(score)

    const statsText =
      'FINAL STATUS\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      `Net worth: $${fancyNum(net)}\n` +
      `Ship: ${gs.capacity} units, ${gs.guns} guns\n` +
      `Played: ${years} yr${years !== 1 ? 's' : ''} ${gs.month} mo\n` +
      `Score: ${score.toLocaleString()}\n` +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      `Rating: ${rating}\n\n` +
      'Tap to continue.'

    await this.display.showText(statsText)

    const again = await this.display.askYesNo('Play again?')
    if (again) {
      this.gs = createInitialState()
      this.emit()
      // The outer while(true) in run() will restart the game
    } else {
      await this.display.showText('Thank you for playing Taipan!\n\nDouble-tap to exit.')
      await this.display.showExitDialog()
    }
  }
}
