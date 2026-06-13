import type { PdfBlock, MdSection } from './parse-blocks.js'

// ── Text normalization ──

export function normalize(s: string): string {
  return s
    .replace(/[#*\s\n\r\t`~|>\\[\]()]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase()
}

// ── LCS-based similarity (longest common substring) ──

export function lcsSimilarity(a: string, b: string): number {
  const shorter = a.length < b.length ? a : b
  const longer = a.length < b.length ? b : a
  if (shorter.length === 0) return 0

  let maxLen = 0
  const window = Math.min(shorter.length, 30)
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

// ── Match markdown paragraphs to PDF blocks ──

export function matchMarkdownToPdf(
  markdown: string,
  blocks: PdfBlock[],
): MdSection[] {
  // Split by line breaks — layout.json / middle.json blocks are line-level
  const paragraphs = markdown.split(/\n+/).filter((p) => p.trim())
  const textBlocks = blocks.filter(
    (b) => b.text && b.text.trim().length > 1,
  )

  if (textBlocks.length === 0) {
    return paragraphs.map((p) => ({ text: p, page: 1, bbox: null }))
  }

  return paragraphs.map((para) => {
    const norm = normalize(para)
    if (norm.length < 4) {
      return { text: para, page: textBlocks[0].page_idx + 1, bbox: textBlocks[0].bbox }
    }

    let best: PdfBlock | null = null
    let bestScore = 0

    // First pass: skip table internals
    const topBlocks = textBlocks.filter(
      (b) => b.type !== 'table-body' && b.type !== 'table-row',
    )
    for (const b of topBlocks) {
      const s = lcsSimilarity(norm, normalize(b.text!))
      if (s > bestScore) {
        bestScore = s
        best = b
      }
    }

    // Fallback: include table blocks
    if (bestScore < 0.2) {
      for (const b of textBlocks) {
        const s = lcsSimilarity(norm, normalize(b.text!))
        if (s > bestScore) {
          bestScore = s
          best = b
        }
      }
    }

    // If nothing matches well, estimate by paragraph position
    if (!best || bestScore < 0.1) {
      const ratio =
        paragraphs.indexOf(para) / Math.max(paragraphs.length, 1)
      const estPage = Math.floor(
        ratio *
          (blocks.length > 0
            ? Math.max(...blocks.map((b) => b.page_idx)) + 1
            : 1),
      )
      return { text: para, page: estPage + 1, bbox: null }
    }

    return { text: para, page: best.page_idx + 1, bbox: best.bbox }
  })
}
