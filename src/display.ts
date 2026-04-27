import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

type InputEvent =
  | { type: 'tap' }
  | { type: 'double_tap' }
  | { type: 'scroll_up' }
  | { type: 'scroll_down' }
  | { type: 'list_select'; idx: number }

const ID_TOP = 1
const ID_BOT = 2
const NAME_TOP = 'top'
const NAME_BOT = 'bot'

// Container factories
function makeText(
  id: number, name: string,
  x: number, y: number, w: number, h: number,
  capture: boolean, content: string, padding = 6,
): TextContainerProperty {
  return new TextContainerProperty({
    containerID: id, containerName: name,
    xPosition: x, yPosition: y, width: w, height: h,
    paddingLength: padding, borderWidth: 0,
    isEventCapture: capture ? 1 : 0,
    content,
  })
}

function makeList(
  id: number, name: string,
  x: number, y: number, w: number, h: number,
  items: string[],
): ListContainerProperty {
  return new ListContainerProperty({
    containerID: id, containerName: name,
    xPosition: x, yPosition: y, width: w, height: h,
    paddingLength: 6, borderWidth: 0, isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: Math.min(items.length, 20),
      itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: items.slice(0, 20),
    }),
  })
}


export class Display {
  private bridge!: EvenAppBridge
  private unsub: (() => void) | null = null
  private queue: InputEvent[] = []
  private resolve: ((e: InputEvent) => void) | null = null
  private lastTopContent = ''
  private currentHasTopList = false

  async init(): Promise<void> {
    this.bridge = await waitForEvenAppBridge()

    this.unsub = this.bridge.onEvenHubEvent(ev => {
      if (ev.listEvent) {
        this.push({ type: 'list_select', idx: ev.listEvent.currentSelectItemIndex ?? 0 })
        return
      }
      if (ev.textEvent) {
        const t = ev.textEvent.eventType ?? 0
        if (t === 1) this.push({ type: 'scroll_up' })
        else if (t === 2) this.push({ type: 'scroll_down' })
        return
      }
      if (ev.sysEvent) {
        const t = ev.sysEvent.eventType ?? 0
        if (t === 0) this.push({ type: 'tap' })
        else if (t === 3) this.push({ type: 'double_tap' })
      }
    })

    // createStartUpPageContainer must be called exactly once
    const startup = new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [makeText(ID_TOP, NAME_TOP, 0, 0, 576, 288, true, '')],
    })
    const result = await this.bridge.createStartUpPageContainer(startup)
    if (result !== 0) console.error('startup failed:', result)
  }

  private push(e: InputEvent): void {
    if (this.resolve) {
      const r = this.resolve
      this.resolve = null
      r(e)
    } else {
      this.queue.push(e)
    }
  }

  private next(): Promise<InputEvent> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!)
    return new Promise(r => { this.resolve = r })
  }

  private clearQueue(): void {
    this.queue = []
  }

  // Full-screen text — any input advances
  async showText(text: string): Promise<void> {
    this.clearQueue()
    this.currentHasTopList = false
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [makeText(ID_TOP, NAME_TOP, 0, 0, 576, 288, true, text)],
    }))
    this.lastTopContent = text
    await this.next()
  }

  // Header text + scrollable list — returns selected index, -1 on double-tap
  async showMenu(header: string, items: string[], topHeight = 130): Promise<number> {
    this.clearQueue()
    this.currentHasTopList = true
    this.lastTopContent = header
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [makeText(ID_TOP, NAME_TOP, 0, 0, 576, topHeight, false, header)],
      listObject: [makeList(ID_BOT, NAME_BOT, 0, topHeight, 576, 288 - topHeight, items)],
    }))

    while (true) {
      const e = await this.next()
      if (e.type === 'list_select') return e.idx
      if (e.type === 'double_tap') return -1
    }
  }

  // In-place header text update (keeps list intact; used during battle)
  async updateTop(text: string): Promise<void> {
    if (!this.currentHasTopList) return
    const oldLen = this.lastTopContent.length
    this.lastTopContent = text
    try {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: ID_TOP, containerName: NAME_TOP,
        contentOffset: 0, contentLength: oldLen,
        content: text,
      }))
    } catch {
      // fallback: next rebuildPageContainer will fix it
    }
  }

  // Yes/No prompt — returns true for Yes
  async askYesNo(text: string): Promise<boolean> {
    const idx = await this.showMenu(text, ['Yes', 'No'], 200)
    return idx === 0
  }

  async showExitDialog(): Promise<void> {
    await this.bridge.shutDownPageContainer(1)
  }

  async saveState(key: string, value: string): Promise<void> {
    await this.bridge.setLocalStorage(key, value)
  }

  async loadState(key: string): Promise<string> {
    return this.bridge.getLocalStorage(key)
  }

  destroy(): void {
    this.unsub?.()
  }
}
