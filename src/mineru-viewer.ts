import { parseBlocks } from './parse-blocks.js'
import { matchMarkdownToPdf } from './match-markdown.js'
import type { PdfBlock, MdSection } from './parse-blocks.js'
import { normalize, lcsSimilarity } from './match-markdown.js'

// We load pdf.js worker from CDN — consumer can override via window.PDFJS_WORKER_SRC
declare const pdfjsLib: typeof import('pdfjs-dist')

const RENDER_SCALE = 2.0

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; font-family: system-ui, sans-serif; color-scheme: light dark; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #e5e5e5; font-size: 12px; color: #888; flex-shrink: 0; flex-wrap: wrap; }
.toolbar .sep { color: #ddd; }
.toolbar .ok { color: #16a34a; }
.toolbar .warn { color: #f59e0b; }
@media (prefers-color-scheme: dark) {
  .toolbar { border-color: #333; }
  .toolbar .sep { color: #555; }
}
.split { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; overflow: hidden; }
.pane { overflow: auto; padding: 10px; }
.pane-left { border-right: 1px solid #e5e5e5; background: #fff; }
.pane-right { background: #fff; }
.pdf-page { position: relative; margin: 0 auto 12px; border: 1px solid #e5e5e5; border-radius: 4px; overflow: hidden; }
.pdf-page img { display: block; width: 100%; }
.pdf-page .page-num { position: absolute; bottom: 2px; right: 4px; font-size: 9px; color: #999; background: rgba(255,255,255,.85); padding: 1px 4px; border-radius: 3px; }
@media (prefers-color-scheme: dark) { .pdf-page { border-color: #333; } .pdf-page .page-num { background: rgba(0,0,0,.7); } }
.block-overlay { position: absolute; border: 1px solid transparent; cursor: pointer; transition: all .15s; }
.block-overlay:hover { border-color: #f59e0b; background: rgba(245,158,11,.12); }
.block-overlay.active { border-color: #3b82f6 !important; background: rgba(59,130,246,.2) !important; z-index: 10; box-shadow: 0 0 0 1px #3b82f6; }
.md-line { display: block; cursor: pointer; padding: 2px 8px; border-radius: 4px; border-left: 2px solid transparent; font-size: 13px; line-height: 1.5; font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.md-line.match { border-left-color: rgba(245,158,11,.4); }
.md-line.match:hover { background: rgba(245,158,11,.08); }
.md-line.no-match { color: #999; opacity: .6; }
.md-line.active { background: rgba(59,130,246,.1); border-left-color: #3b82f6; box-shadow: inset 0 0 0 1px rgba(59,130,246,.3); }
@media (prefers-color-scheme: dark) { .md-line.active { background: rgba(59,130,246,.15); } }
.md-line .badge { font-size: 10px; color: #999; margin-left: 6px; }
`

export class MineruLayoutViewer extends HTMLElement {
  private blocks: PdfBlock[] = []
  private sections: MdSection[] = []
  private pages: { p: number; w: number; h: number; src: string }[] = []
  private activeIdx: number | null = null
  private pdfUrl: string | null = null
  private layoutData: string | null = null
  private markdownText: string | null = null

  static observedAttributes = ['pdf', 'layout', 'markdown']

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  connectedCallback() {
    this.render()
    this.setupResize()
  }

  attributeChangedCallback(name: string, _old: string | null, newVal: string | null) {
    if (name === 'pdf' && newVal) {
      this.pdfUrl = newVal
      this.loadPdf(newVal)
    }
    if (name === 'layout' && newVal) {
      this.loadLayout(newVal)
    }
    if (name === 'markdown' && newVal) {
      this.markdownText = newVal
      this.rebuild()
    }
  }

  // ── Public API ──

  set pdf(value: string) { this.setAttribute('pdf', value) }
  get pdf(): string { return this.getAttribute('pdf') || '' }

  set layout(value: string) { this.setAttribute('layout', value) }
  get layout(): string { return this.getAttribute('layout') || '' }

  set markdown(value: string) { this.setAttribute('markdown', value) }
  get markdown(): string { return this.getAttribute('markdown') || '' }

  /** Programmatic API: load layout JSON directly */
  async loadLayoutFromJson(data: Record<string, unknown> | string) {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data)
    this.layoutData = jsonStr
    if (this.pdfUrl) this.rebuild()
  }

  /** Programmatic API: load markdown text directly */
  async loadMarkdown(text: string) {
    this.markdownText = text
    if (this.layoutData) this.rebuild()
  }

  /** Programmatic API: load PDF + layout from a MinerU zip Blob */
  async loadZip(zipBlob: Blob) {
    const JSZip = (window as any).JSZip || await import('jszip').then(m => m.default)
    const zip = await JSZip.loadAsync(zipBlob)
    let jsonStr = ''

    for (const name of ['layout.json', 'middle.json']) {
      const f = zip.file(name); if (f) { jsonStr = await f.async('text'); break }
    }
    if (!jsonStr) {
      for (const name of Object.keys(zip.files)) {
        if (name.endsWith('_layout.json') || name.endsWith('_middle.json')) {
          jsonStr = await zip.file(name)!.async('text'); break
        }
      }
    }
    if (!jsonStr) {
      for (const name of Object.keys(zip.files)) {
        if (name.endsWith('_content_list.json')) {
          jsonStr = await zip.file(name)!.async('text'); break
        }
      }
    }

    const mdFile = zip.file('full.md')
    if (mdFile) this.markdownText = await mdFile.async('text')

    this.layoutData = jsonStr

    // Find PDF
    for (const name of Object.keys(zip.files)) {
      if (name.endsWith('_origin.pdf')) {
        const blob = await zip.file(name)!.async('blob')
        this.pdfUrl = URL.createObjectURL(blob)
        break
      }
    }

    if (this.layoutData) this.rebuild()
    else throw new Error('zip 缺少 layout.json 或 middle.json')
  }

  // ── Internal ──

  private render() {
    if (!this.shadowRoot) return
    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <div class="toolbar">
        <span id="stat"></span>
        <span style="flex:1"></span>
        <a href="https://www.npmjs.com/package/mineru-layout-viewer" target="_blank" title="npm" style="color:inherit;display:flex;align-items:center;opacity:.5;transition:opacity .15s" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.5'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v1.336h-1.336v1.336h-2.668V8.667h5.334v5.331z"/></svg>
        </a>
        <a href="https://github.com/rand777gg/mineru-layout-viewer" target="_blank" title="GitHub" style="color:inherit;display:flex;align-items:center;opacity:.5;transition:opacity .15s;margin-left:4px" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.5'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
        </a>
      </div>
      <div class="split">
        <div class="pane pane-left" id="pdfPane"><slot name="loading">加载 PDF + layout.json 以开始</slot></div>
        <div class="pane pane-right" id="mdPane"></div>
      </div>`
  }

  private setupResize() {
    const ro = new ResizeObserver(() => this.buildPdfOverlays())
    const pane = this.shadowRoot?.getElementById('pdfPane')
    if (pane) ro.observe(pane)
  }

  private async loadPdf(url: string) {
    this.pdfUrl = url
    if (this.layoutData || this.markdownText) await this.rebuild()
  }

  private async loadLayout(url: string) {
    const res = await fetch(url)
    this.layoutData = await res.text()
    if (this.pdfUrl) await this.rebuild()
  }

  private async rebuild() {
    if (!this.layoutData) return
    this.blocks = parseBlocks(this.layoutData)
    const md = this.markdownText || this.blocks.map(b => b.text || '').filter(Boolean).join('\n')
    this.sections = matchMarkdownToPdf(md, this.blocks)
    if (this.pdfUrl) await this.renderPdfPages()
    this.buildUI()
  }

  private async renderPdfPages() {
    if (!this.pdfUrl) return
    const pdf = await pdfjsLib.getDocument(this.pdfUrl).promise
    this.pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const vp = page.getViewport({ scale: RENDER_SCALE })
      const cvs = document.createElement('canvas')
      cvs.width = vp.width; cvs.height = vp.height
      await page.render({ canvasContext: cvs.getContext('2d')!, viewport: vp }).promise
      this.pages.push({ p: i, w: vp.width, h: vp.height, src: cvs.toDataURL() })
      page.cleanup()
    }
    pdf.destroy()
  }

  private buildUI() {
    const shadow = this.shadowRoot!
    const matched = this.sections.filter(s => s.bbox).length
    shadow.getElementById('stat')!.innerHTML =
      `${this.pages.length} 页 | ${this.sections.length} 行 | <span class="${matched > 0 ? 'ok' : 'warn'}">匹配 ${matched}</span> | ${this.blocks.length} 块`
    this.buildPdfOverlays()
    this.buildMarkdown()
  }

  private buildPdfOverlays() {
    const pane = this.shadowRoot!.getElementById('pdfPane')!
    pane.innerHTML = ''
    const containerW = pane.clientWidth - 20
    if (containerW <= 0 || this.pages.length === 0) return

    for (const rp of this.pages) {
      const cssW = containerW
      const cssH = rp.h * (containerW / rp.w)
      const pageBlocks = this.blocks.filter(b => b.page_idx === rp.p - 1)
      const pageScale = containerW / rp.w
      const s = RENDER_SCALE * pageScale

      const wrapper = document.createElement('div')
      wrapper.className = 'pdf-page'
      wrapper.style.width = cssW + 'px'; wrapper.style.height = cssH + 'px'
      wrapper.dataset.page = String(rp.p)

      const img = document.createElement('img'); img.src = rp.src
      wrapper.appendChild(img)
      const label = document.createElement('span'); label.className = 'page-num'; label.textContent = String(rp.p)
      wrapper.appendChild(label)

      for (const b of pageBlocks) {
        const [x0, y0, x1, y1] = b.bbox
        const ov = document.createElement('div'); ov.className = 'block-overlay'
        ov.style.left = (x0 * s) + 'px'; ov.style.top = (y0 * s) + 'px'
        ov.style.width = Math.max((x1 - x0) * s, 2) + 'px'
        ov.style.height = Math.max((y1 - y0) * s, 2) + 'px'
        ov.title = (b.text || '').slice(0, 120)
        ov.addEventListener('click', () => this.onBlockClick(b, ov))
        wrapper.appendChild(ov)
      }
      pane.appendChild(wrapper)
    }
  }

  private buildMarkdown() {
    const pane = this.shadowRoot!.getElementById('mdPane')!
    pane.innerHTML = ''
    for (let i = 0; i < this.sections.length; i++) {
      const sec = this.sections[i]
      const el = document.createElement('span')
      el.className = 'md-line' + (sec.bbox ? ' match' : ' no-match')
      el.dataset.idx = String(i)
      el.textContent = sec.text
      if (sec.bbox) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = `p${sec.page}`; el.appendChild(b) }
      el.addEventListener('click', () => this.onMdClick(sec, i, el))
      pane.appendChild(el)
    }
  }

  private onMdClick(sec: MdSection, idx: number, el: HTMLElement) {
    const shadow = this.shadowRoot!
    shadow.querySelectorAll('.md-line.active').forEach(e => e.classList.remove('active'))
    shadow.querySelectorAll('.block-overlay.active').forEach(e => e.classList.remove('active'))
    el.classList.add('active'); this.activeIdx = idx
    if (sec.bbox) {
      const pageEl = shadow.querySelector(`.pdf-page[data-page="${sec.page}"]`) as HTMLElement | null
      if (pageEl) pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const overlays = shadow.querySelectorAll(`.pdf-page[data-page="${sec.page}"] .block-overlay`)
      const page = this.pages[sec.page - 1]
      if (page) {
        const pw = shadow.getElementById('pdfPane')!.clientWidth - 20
        const s = RENDER_SCALE * (pw / page.w)
        overlays.forEach(ov => {
          const el2 = ov as HTMLElement
          const dx = Math.abs(parseFloat(el2.style.left) - sec.bbox![0] * s)
          const dy = Math.abs(parseFloat(el2.style.top) - sec.bbox![1] * s)
          if (dx < 4 && dy < 4) {
            el2.classList.add('active'); el2.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        })
      }
    }
  }

  private onBlockClick(block: PdfBlock, ov: HTMLElement) {
    const shadow = this.shadowRoot!
    shadow.querySelectorAll('.md-line.active').forEach(e => e.classList.remove('active'))
    shadow.querySelectorAll('.block-overlay.active').forEach(e => e.classList.remove('active'))
    ov.classList.add('active')
    const blockNorm = normalize(block.text || '')
    let bestIdx = -1, bestSim = 0
    for (let i = 0; i < this.sections.length; i++) {
      if (!this.sections[i].bbox) continue
      const sim = lcsSimilarity(blockNorm, normalize(this.sections[i].text))
      if (sim > bestSim && sim > 0.05) { bestSim = sim; bestIdx = i }
    }
    if (bestIdx >= 0) {
      this.activeIdx = bestIdx
      const el = shadow.querySelector(`[data-idx="${bestIdx}"]`) as HTMLElement | null
      if (el) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('mineru-layout-viewer')) {
  customElements.define('mineru-layout-viewer', MineruLayoutViewer)
}
