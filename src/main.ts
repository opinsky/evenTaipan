import { Display } from './display'
import { Game } from './game'
import { GameState } from './constants'
import { fancyNum, statusText } from './logic'
import { LOCATIONS } from './constants'

const statusEl = document.getElementById('status')!
const gameStateEl = document.getElementById('game-state')!

function updateWebStatus(gs: GameState): void {
  statusEl.textContent = `${LOCATIONS[gs.port]} — ${gs.firm}`
  gameStateEl.textContent = [
    `Cash:   $${fancyNum(gs.cash)}`,
    `Bank:   $${fancyNum(gs.bank)}`,
    `Debt:   $${fancyNum(gs.debt)}`,
    `Ship:   ${statusText(gs)}  (${gs.capacity} cap, ${gs.guns} guns)`,
    `Hold:   ${gs.hold} free`,
    `Month:  ${gs.month}/${gs.year}`,
  ].join('\n')
}

async function main(): Promise<void> {
  statusEl.textContent = 'Initializing...'

  const display = new Display()
  await display.init()

  statusEl.textContent = 'Game running on glasses'

  const game = new Game(display, updateWebStatus)
  await game.run()
}

main().catch(err => {
  console.error(err)
  statusEl.textContent = 'Error: ' + String(err)
})
