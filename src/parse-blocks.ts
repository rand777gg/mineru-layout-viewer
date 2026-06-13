// ── Block types ──

export interface PdfBlock {
  page_idx: number
  bbox: [number, number, number, number]
  text?: string
  type?: string
}

export interface MdSection {
  text: string
  page: number
  bbox: [number, number, number, number] | null
}

// ── Text extraction from layout.json / middle.json span structure ──

export function extractSpanText(block: Record<string, unknown>): string {
  const lines = block.lines as Array<Record<string, unknown>> | undefined
  if (!lines) return (block.text as string) || ''
  const texts: string[] = []
  for (const line of lines) {
    const spans = line.spans as Array<Record<string, unknown>> | undefined
    if (spans) {
      for (const span of spans) {
        if (span.content) texts.push(String(span.content))
      }
    }
  }
  return texts.join(' ') || (block.text as string) || ''
}

// ── Block parser (supports layout.json, middle.json, content_list.json) ──

export function parseBlocks(jsonStr: string): PdfBlock[] {
  const result: PdfBlock[] = []
  try {
    const data = JSON.parse(jsonStr)

    // layout.json / middle.json: { pdf_info: [{ preproc_blocks, ... }, ...] }
    if (data.pdf_info && Array.isArray(data.pdf_info)) {
      const walkLayout = (items: Record<string, unknown>[], pageIdx: number) => {
        for (const item of items) {
          if (!item.bbox) continue
          const childBlocks = item.blocks as Record<string, unknown>[] | undefined
          if (childBlocks && childBlocks.length > 0) {
            walkLayout(childBlocks, pageIdx)
          } else {
            result.push({
              page_idx: pageIdx,
              bbox: item.bbox as [number, number, number, number],
              text: extractSpanText(item) || undefined,
              type: item.type as string | undefined,
            })
          }
        }
      }
      for (let i = 0; i < data.pdf_info.length; i++) {
        const page = data.pdf_info[i] as Record<string, unknown>
        const blocks = (page.preproc_blocks || page.para_blocks || []) as Record<string, unknown>[]
        walkLayout(blocks, i)
      }
      return result
    }

    // content_list.json: [{ page_idx, bbox, text, type, children?, blocks? }, ...]
    if (!Array.isArray(data)) return result
    const walk = (items: Record<string, unknown>[]) => {
      for (const item of items) {
        const idx = (item.page_idx ?? item.page_index) as number | undefined
        if (idx !== undefined && item.bbox) {
          result.push({
            page_idx: idx,
            bbox: item.bbox as [number, number, number, number],
            text: (item.text as string) || undefined,
            type: (item.category || item.type) as string | undefined,
          })
        }
        if (Array.isArray(item.children)) walk(item.children as Record<string, unknown>[])
        if (Array.isArray(item.blocks)) walk(item.blocks as Record<string, unknown>[])
      }
    }
    walk(data)
  } catch { /* ignore parse errors */ }
  return result
}
