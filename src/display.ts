import {
  waitForEvenAppBridge,
  EvenAppBridge,
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  ImageRawDataUpdate,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

type InputEvent =
  | { type: 'tap' }
  | { type: 'scroll_up' }
  | { type: 'scroll_down' }
  | { type: 'list_select'; idx: number }

const ID_TOP = 1
const ID_BOT = 2
const NAME_TOP = 'top'
const NAME_BOT = 'bot'

// Shared port/sub-menu layout geometry
const LEFT_W = 376
const LIST_X = LEFT_W
const LIST_W = 576 - LEFT_W  // 200
const STATUS_H = 160          // fits 5 status lines (HK) or 4 (other ports)
const PRICES_H = 284 - STATUS_H  // 124 — fits 4 cargo rows
const NAMES_W = 130

// Container factories
function makeText(
  id: number, name: string,
  x: number, y: number, w: number, h: number,
  capture: boolean, content: string, padding = 6, border = 0,
): TextContainerProperty {
  return new TextContainerProperty({
    containerID: id, containerName: name,
    xPosition: x, yPosition: y, width: w, height: h,
    paddingLength: padding, borderWidth: border,
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

function makeImage(
  id: number, name: string,
  x: number, y: number, w: number, h: number,
): ImageContainerProperty {
  return new ImageContainerProperty({
    containerID: id, containerName: name,
    xPosition: x, yPosition: y, width: w, height: h,
  })
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${src}`))
    img.src = src
  })
}

// Render image to canvas at target size and export as PNG bytes
// (the SDK/simulator decodes image-format data, not raw pixels)
function toPngBytes(img: HTMLImageElement, dstW: number, dstH: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = dstW
  canvas.height = dstH
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, dstW, dstH)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('toBlob failed')); return }
      blob.arrayBuffer().then(ab => resolve(new Uint8Array(ab))).catch(reject)
    }, 'image/png')
  })
}

export class Display {
  private bridge!: EvenAppBridge
  private unsub: (() => void) | null = null
  private queue: InputEvent[] = []
  private resolve: ((e: InputEvent) => void) | null = null
  private lastTopContent = ''
  private currentHasTopList = false
  private portHeader = ''
  private portCargoNames = ''
  private portCargoPrices = ''
  private exitEnabled = false

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
        else if (t === 3 && this.exitEnabled) {
          // Canonical Even Hub exit: call directly in event callback, no await
          this.bridge.shutDownPageContainer(1)
        }
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

  setExitEnabled(enabled: boolean): void {
    this.exitEnabled = enabled
  }

  // Splash: 200×100 image centered at top + title text below, any tap advances
  async showSplash(imageSrc: string): Promise<void> {
    this.clearQueue()
    this.currentHasTopList = false
    const imgX = Math.floor((576 - 200) / 2)  // center horizontally
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 2,
      imageObject: [makeImage(1, 'splash', imgX, 4, 200, 100)],
      textObject: [makeText(2, 'splash-t', 0, 110, 576, 174, true,
        'T  A  I  P  A  N\nChina Trade, 1860\n\nTap to begin\n2× tap: exit (at port)', 12)],
    }))
    try {
      const img = await loadImg(imageSrc)
      await this.bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: 1, containerName: 'splash',
        imageData: await toPngBytes(img, 200, 100),
      }))
    } catch (err) {
      console.error('Splash image failed:', err)
    }
    await this.next()
  }

  // Full-screen text — any input advances
  async showText(text: string): Promise<void> {
    this.clearQueue()
    this.currentHasTopList = false
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 1,
      textObject: [makeText(ID_TOP, NAME_TOP, 0, 0, 576, 284, true, text)],
    }))
    this.lastTopContent = text
    await this.next()
  }

  // Header text + scrollable list — returns selected index
  async showMenu(header: string, items: string[], topHeight = 130): Promise<number> {
    this.clearQueue()
    this.currentHasTopList = true
    this.lastTopContent = header
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 2,
      textObject: [makeText(ID_TOP, NAME_TOP, 0, 0, 576, topHeight, false, header)],
      listObject: [makeList(ID_BOT, NAME_BOT, 0, topHeight, 576, 284 - topHeight, items)],
    }))

    while (true) {
      const e = await this.next()
      if (e.type === 'list_select') return e.idx
    }
  }

  // Port status layout:
  //   left col (376px): status header top | cargo names + prices bottom (bordered)
  //   right col (200px): full-height action list
  async showMenuWithSidebar(
    header: string, items: string[], cargoNames: string, cargoPrices: string,
  ): Promise<number> {
    this.clearQueue()
    this.currentHasTopList = false
    this.lastTopContent = header
    this.portHeader = header
    this.portCargoNames = cargoNames
    this.portCargoPrices = cargoPrices
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 4,
      textObject: [
        makeText(ID_TOP, NAME_TOP, 0, 0, LEFT_W, STATUS_H, false, header, 5),
        makeText(3, 'cnames', 0, STATUS_H, NAMES_W, PRICES_H, false, cargoNames, 4),
        makeText(4, 'cprices', NAMES_W, STATUS_H, LEFT_W - NAMES_W, PRICES_H, false, cargoPrices, 4),
      ],
      listObject: [makeList(ID_BOT, NAME_BOT, LIST_X, 0, LIST_W, 284, items)],
    }))

    while (true) {
      const e = await this.next()
      if (e.type === 'list_select') return e.idx
    }
  }

  // Sub-menu layout: status stays top-left, cargo info stays bottom-left (both unchanged),
  // optional question header at top-right, interactive list below it (or full-height if topHeight=0).
  async showMenuInRight(header: string, items: string[], topHeight = 50): Promise<number> {
    this.clearQueue()
    this.currentHasTopList = false
    const textContainers = [
      makeText(ID_TOP, NAME_TOP, 0, 0, LEFT_W, STATUS_H, false, this.portHeader, 5),
      makeText(3, 'cnames', 0, STATUS_H, NAMES_W, PRICES_H, false, this.portCargoNames, 4),
      makeText(4, 'cprices', NAMES_W, STATUS_H, LEFT_W - NAMES_W, PRICES_H, false, this.portCargoPrices, 4),
    ]
    if (topHeight > 0) {
      textContainers.push(makeText(5, 'smhdr', LIST_X, 0, LIST_W, topHeight, false, header))
    }
    await this.bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: textContainers.length + 1,
      textObject: textContainers,
      listObject: [makeList(ID_BOT, NAME_BOT, LIST_X, topHeight, LIST_W, 284 - topHeight, items)],
    }))

    while (true) {
      const e = await this.next()
      if (e.type === 'list_select') return e.idx
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

  // Yes/No prompt — returns true for Yes; pass defaultYes=false to highlight No first
  async askYesNo(text: string, defaultYes = true): Promise<boolean> {
    if (defaultYes) {
      return (await this.showMenu(text, ['Yes', 'No'], 160)) === 0
    }
    return (await this.showMenu(text, ['No', 'Yes'], 160)) === 1
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
