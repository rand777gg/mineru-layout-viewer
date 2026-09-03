import type { PdfBlock, MdSection } from './parse-blocks.js'

// ── Text normalization ──
//
// We normalize before every comparison so minor differences between MinerU's
// `full.md` output and the raw span text in layout.json don't hide a real match:
//   - strip markdown syntax (#, *, `, >, table pipes, link/ref brackets, …)
//   - strip leading list markers ("- ", "1. ", "1) ") and numbering
//   - collapse whitespace, unify CJK full/half width, lowercase ASCII

export function normalize(s: string): string {
  return s
    .replace(/^\s*[-*+•]\s+/gm, ' ')        // unordered list markers
    .replace(/^\s*\d{1,4}[.)、]\s+/gm, ' ')  // ordered list markers / numbering
    .replace(/[#*_`~|>\\[\](){}!]/g, ' ')   // markdown / latex fences & symbols
    .replace(/\s{2,}/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // full→half width
    .trim()
    .toLowerCase()
}

// ── Similarity core ──

// Dice coefficient over character bigrams. Bigrams capture character adjacency,
// which matters a lot for CJK text (no spaces to tokenize) and is O(n) to compute.
function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const build = (s: string) => {
    const map = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      map.set(g, (map.get(g) || 0) + 1)
    }
    return map
  }
  const sa = build(a)
  const sb = build(b)
  let inter = 0
  let total = 0
  for (const [g, ca] of sa) {
    const cb = sb.get(g)
    inter += cb ? Math.min(ca, cb) : 0
  }
  for (const [g, ca] of sa) total += ca
  for (const [g, cb] of sb) total += cb
  return total === 0 ? 0 : (2 * inter) / total
}

// Longest common substring ratio, sliding over the shorter string (bounded so it
// stays cheap even on long paragraphs). Returns 0..1.
function substringRatio(a: string, b: string): number {
  const shorter = a.length < b.length ? a : b
  const longer = a.length < b.length ? b : a
  if (shorter.length === 0) return 0
  let maxLen = 0
  const window = Math.min(shorter.length, 40)
  for (let i = 0; i < shorter.length; i++) {
    if (shorter.length - i <= maxLen) break
    for (let len = window; len > maxLen; len--) {
      const sub = shorter.substring(i, i + len)
      if (sub.length < 4) continue
      if (longer.includes(sub)) {
        maxLen = sub.length
        break
      }
    }
  }
  return maxLen / Math.max(shorter.length, 1)
}

// Combined similarity in [0,1].
//   - Bigram Dice is the primary signal (robust to symbol-heavy markdown, works
//     for unsegmented CJK).
//   - Substring ratio is a strong secondary for verbatim ASCII-copied lines, but
//     is scaled by the length ratio so a paragraph isn't just a "contained" drop
//     inside a much larger block.
//   - The final max keeps exact-copy lines at a high score.
export function similarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  const dice = bigramDice(a, b)
  const sub = substringRatio(a, b)
  const fused = dice * 0.7 + sub * lenRatio * 0.3
  return Math.max(fused, sub * 0.55)
}

// LCS-style util kept for API compatibility. Returns the same 0..1 longest-common-
// substring ratio as the original implementation.
export function lcsSimilarity(a: string, b: string): number {
  return substringRatio(a, b)
}

// ── Match markdown paragraphs to PDF blocks ──
//
// Strategy: match in *reading order*.
//
// 1. Split markdown on blank lines into paragraphs (not every newline). MinerU
//    `full.md` is already hard-wrapped, and layout blocks are line/paragraph-level,
//    so collapsing wrapped runs into one unit cuts fragmentation and false hits on
//    short wrapped lines.
// 2. Walk paragraphs top→bottom while advancing a rolling block window that can
//    only move forward across pages (and down each page). Enforcing monotonicity
//    kills the classic failure where an early paragraph snaps to a later repeated
//    block (e.g. "答案：A", table headers, figure captions).
// 3. If the best score clears a low threshold we commit the match and advance the
//    pointer; otherwise the paragraph stays bbox-less rather than guessing a page.
// 4. When nothing matches in the current window we widen it one page group ahead
//    once (paragraphs can sit across page breaks) before giving up.

const PARAGRAPH_RE = /\n\s*\n+/
const MIN_SIM = 0.28
const MAX_FORWARD_PAGES = 4

// Blocks that carry little per-line text payload — don't let a bare title/figure
// steal a paragraph match unless nothing else fits.
const WEAK_TYPES = new Set(['image', 'figure', 'table', 'table-body', 'table-row'])

export function matchMarkdownToPdf(
  markdown: string,
  blocks: PdfBlock[],
): MdSection[] {
  const paragraphs = markdown
    .split(PARAGRAPH_RE)
    .map((p) => p.replace(/\n+/g, ' ').trim())
    .filter((p) => p.length > 0)

  if (paragraphs.length === 0) return []

  if (blocks.length === 0) {
    return paragraphs.map((p) => ({ text: p, page: 1, bbox: null }))
  }

  // Group blocks by page, preserving layout order within each page.
  const byPage = new Map<number, PdfBlock[]>()
  for (const b of blocks) {
    let arr = byPage.get(b.page_idx)
    if (!arr) { arr = []; byPage.set(b.page_idx, arr) }
    arr.push(b)
  }
  const pageList = Array.from(byPage.keys()).sort((x, y) => x - y)
  const firstPage = pageList[0]

  // Normalize each block once (title/headings first for ordering hints).
  const nb = new Map<PdfBlock, string>()
  const norm = (b: PdfBlock): string => {
    let n = nb.get(b)
    if (n === undefined) { n = normalize(b.text || ''); nb.set(b, n) }
    return n
  }
  const skipWeak = (b: PdfBlock): boolean => !!b.type && WEAK_TYPES.has(b.type)

  const sections: MdSection[] = []

  // Reading-order pointer: [pageListIdx, blockIdxWithinPage].
  let curPage = 0
  const curBlock = new Map<number, number>() // consumed pointer per page

  // Each iteration consumes candidate blocks in order from the pointer; candidates
  // are laid out [current page ... current page + MAX_FORWARD_PAGES).
  const candidateBlocks = (): PdfBlock[] => {
    const out: PdfBlock[] = []
    for (let pi = curPage; pi < Math.min(pageList.length, curPage + MAX_FORWARD_PAGES); pi++) {
      const arr = byPage.get(pageList[pi]) || []
      const from = curBlock.get(pageList[pi]) || 0
      for (let i = from; i < arr.length; i++) out.push(arr[i])
    }
    return out
  }

  // Commit a match: move the pointer past every candidate that precedes/equals the
  // matched block, across pages, so later paragraphs can only match further down.
  const commit = (matched: PdfBlock) => {
    let advanced = false
    for (let pi = curPage; pi < pageList.length; pi++) {
      const page = pageList[pi]
      const arr = byPage.get(page) || []
      const idx = arr.indexOf(matched)
      if (idx >= 0) {
        curBlock.set(page, idx + 1)
        curPage = pi
        advanced = true
        break
      }
      // fully consume any earlier page entirely
      curBlock.set(page, arr.length)
    }
    if (!advanced) curPage = Math.max(curPage, 0)
  }

  for (const para of paragraphs) {
    const n = normalize(para)
    if (n.length < 3) {
      sections.push({ text: para, page: firstPage + 1, bbox: null })
      continue
    }

    const candidates = candidateBlocks()
    let best: PdfBlock | null = null
    let bestScore = 0

    // Pass 1: text-bearing blocks only.
    for (const b of candidates) {
      const nbText = norm(b)
      if (skipWeak(b) || nbText.length < 3) continue
      const s = similarity(n, nbText)
      if (s > bestScore) { bestScore = s; best = b }
    }
    // Pass 2: if nothing strong, allow weak container blocks (image/table captions).
    if (bestScore < MIN_SIM) {
      for (const b of candidates) {
        const nbText = norm(b)
        if (nbText.length < 3) continue
        const s = similarity(n, nbText)
        if (s > bestScore) { bestScore = s; best = b }
      }
    }

    // Pass 3: nothing in the current forward window — advance one page group and retry.
    if (bestScore < MIN_SIM && curPage < pageList.length - 1) {
      const next = pageList[Math.min(curPage + 1, pageList.length - 1)]
      const arr = byPage.get(next) || []
      const from = curBlock.get(next) || 0
      for (let i = from; i < arr.length; i++) {
        const b = arr[i]
        const nbText = norm(b)
        if (nbText.length < 3) continue
        const s = similarity(n, nbText)
        if (s > bestScore) { bestScore = s; best = b }
      }
    }

    if (!best || bestScore < MIN_SIM) {
      sections.push({ text: para, page: firstPage + 1, bbox: null })
      continue
    }

    commit(best)
    sections.push({ text: para, page: best.page_idx + 1, bbox: best.bbox })
  }

  return sections
}
