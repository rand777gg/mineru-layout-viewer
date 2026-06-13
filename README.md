# MinerU Layout Viewer

Visualize [MinerU](https://github.com/opendatalab/MinerU) `layout.json` / `middle.json` output — side-by-side PDF + Markdown with bidirectional click-to-navigate.

[English](#english) | [中文](#chinese)

---

<a name="english"></a>
## English

### Demo

Drop a MinerU export `.zip` (or PDF + `layout.json`) onto the page:

```html
<mineru-layout-viewer
  pdf="document.pdf"
  layout="layout.json"
  markdown="full.md">
</mineru-layout-viewer>
```

### Features

- **Dual-pane view** — PDF pages on the left, Markdown text on the right
- **Bidirectional navigation** — click a Markdown line → scrolls to the corresponding PDF block and highlights it; click a PDF overlay → scrolls to the matching Markdown line
- **Multi-format support** — automatically detects `layout.json`, `middle.json`, and `content_list.json`
- **Nested block handling** — resolves list items, table cells, and other nested blocks to their leaf coordinates
- **Framework-agnostic** — built as a Web Component, works with React, Vue, or plain HTML
- **Zip support** — drop a MinerU output `.zip` directly, auto-extracts PDF + layout + markdown

### Installation

```bash
npm install mineru-layout-viewer
```

#### Via CDN

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://unpkg.com/mineru-layout-viewer/dist/mineru-layout-viewer.iife.js"></script>
```

Set the PDF.js worker:

```html
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
</script>
```

### Usage

#### HTML / Web Component

```html
<!-- Attribute-based -->
<mineru-layout-viewer
  pdf="./document.pdf"
  layout="./layout.json"
  markdown="./full.md">
</mineru-layout-viewer>

<!-- Programmatic API (zip) -->
<script>
  const viewer = document.querySelector('mineru-layout-viewer')
  await viewer.loadZip(zipBlob)  // from MinerU export .zip
</script>

<!-- Programmatic API (JSON) -->
<script>
  const viewer = document.querySelector('mineru-layout-viewer')
  viewer.loadLayoutFromJson(jsonData)
  viewer.loadMarkdown(markdownText)
</script>
```

#### JavaScript / ESM

```js
import {
  parseBlocks,
  matchMarkdownToPdf,
  MineruLayoutViewer,
} from 'mineru-layout-viewer'

// Parse a layout.json string into blocks
const blocks = parseBlocks(layoutJsonStr)

// Match markdown paragraphs to PDF blocks
const sections = matchMarkdownToPdf(markdown, blocks)

// Each section: { text, page, bbox: [x0,y0,x1,y1] | null }
```

### API

#### `parseBlocks(jsonStr: string): PdfBlock[]`

Parses a MinerU JSON file (`layout.json`, `middle.json`, or `content_list.json`) into an array of leaf-level blocks.

```ts
interface PdfBlock {
  page_idx: number              // 0-based page index
  bbox: [number, number, number, number]  // [x0, y0, x1, y1] — top-left origin
  text?: string                  // extracted span content
  type?: string                  // block type: "text", "title", "list", etc.
}
```

#### `matchMarkdownToPdf(markdown: string, blocks: PdfBlock[]): MdSection[]`

Matches markdown text (split by lines) to PDF blocks using LCS similarity.

```ts
interface MdSection {
  text: string
  page: number                   // 1-based page number
  bbox: [number, number, number, number] | null
}
```

#### `<mineru-layout-viewer>` Attributes

| Attribute  | Description                              |
|------------|------------------------------------------|
| `pdf`      | URL to the PDF file                      |
| `layout`   | URL to `layout.json` / `middle.json`     |
| `markdown` | URL to `full.md` (optional)              |

#### `<mineru-layout-viewer>` Methods

| Method                                  | Description                           |
|-----------------------------------------|---------------------------------------|
| `loadZip(blob: Blob): Promise<void>`    | Load from a MinerU export .zip        |
| `loadLayoutFromJson(data: object\|string)`| Load layout JSON directly           |
| `loadMarkdown(text: string)`            | Load markdown text directly           |

### Supported JSON Formats

| Format              | Structure                          | Origin    |
|---------------------|------------------------------------|-----------|
| `layout.json`       | `{ pdf_info: [{ preproc_blocks }] }` | top-left  |
| `middle.json`       | `{ pdf_info: [{ preproc_blocks }] }` | top-left  |
| `content_list.json` | `[{ page_idx, bbox, text }]`       | 0–1000    |

### License

MIT

---

<a name="chinese"></a>
## 中文

### 演示

将 MinerU 导出 `.zip`（或 PDF + `layout.json`）拖放到页面上即可：

```html
<mineru-layout-viewer
  pdf="document.pdf"
  layout="layout.json"
  markdown="full.md">
</mineru-layout-viewer>
```

### 特性

- **双栏对照** — 左侧 PDF 页面，右侧 Markdown 文本
- **双向定位** — 点击 Markdown 行 → 滚动到对应 PDF 块并高亮；点击 PDF 覆盖块 → 滚动到匹配的 Markdown 行
- **多格式支持** — 自动识别 `layout.json`、`middle.json`、`content_list.json`
- **嵌套块解析** — 将列表项、表格单元格等嵌套块解析到叶子节点坐标
- **框架无关** — 基于 Web Component，支持 React、Vue 或原生 HTML
- **Zip 直拖** — 直接拖放 MinerU 输出 `.zip`，自动解压 PDF + layout + markdown

### 安装

```bash
npm install mineru-layout-viewer
```

#### CDN 引入

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://unpkg.com/mineru-layout-viewer/dist/mineru-layout-viewer.iife.js"></script>
```

设置 PDF.js Worker：

```html
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
</script>
```

### 使用方式

#### HTML / Web Component

```html
<!-- 属性方式 -->
<mineru-layout-viewer
  pdf="./document.pdf"
  layout="./layout.json"
  markdown="./full.md">
</mineru-layout-viewer>

<!-- 编程 API（从 zip 加载） -->
<script>
  const viewer = document.querySelector('mineru-layout-viewer')
  await viewer.loadZip(zipBlob)  // 从 MinerU 导出 .zip 加载
</script>

<!-- 编程 API（直接传 JSON） -->
<script>
  const viewer = document.querySelector('mineru-layout-viewer')
  viewer.loadLayoutFromJson(jsonData)
  viewer.loadMarkdown(markdownText)
</script>
```

#### JavaScript / ESM

```js
import {
  parseBlocks,
  matchMarkdownToPdf,
  MineruLayoutViewer,
} from 'mineru-layout-viewer'

// 解析 layout.json 字符串为 block 数组
const blocks = parseBlocks(layoutJsonStr)

// 将 markdown 段落匹配到 PDF block
const sections = matchMarkdownToPdf(markdown, blocks)

// 每个 section: { text, page, bbox: [x0,y0,x1,y1] | null }
```

### API

#### `parseBlocks(jsonStr: string): PdfBlock[]`

将 MinerU JSON 文件（`layout.json`、`middle.json` 或 `content_list.json`）解析为叶子级 block 数组。

```ts
interface PdfBlock {
  page_idx: number              // 0-based 页码
  bbox: [number, number, number, number]  // [x0, y0, x1, y1] — 左上角原点
  text?: string                  // 提取的 span 文本
  type?: string                  // block 类型："text"、"title"、"list" 等
}
```

#### `matchMarkdownToPdf(markdown: string, blocks: PdfBlock[]): MdSection[]`

使用 LCS 相似度将 Markdown 文本（按行分割）匹配到 PDF block。

```ts
interface MdSection {
  text: string
  page: number                   // 1-based 页码
  bbox: [number, number, number, number] | null
}
```

#### `<mineru-layout-viewer>` 属性

| 属性       | 说明                                   |
|------------|----------------------------------------|
| `pdf`      | PDF 文件 URL                           |
| `layout`   | `layout.json` / `middle.json` 文件 URL |
| `markdown` | `full.md` 文件 URL（可选）              |

#### `<mineru-layout-viewer>` 方法

| 方法                                    | 说明                        |
|-----------------------------------------|-----------------------------|
| `loadZip(blob: Blob): Promise<void>`    | 从 Mineru 导出 .zip 加载    |
| `loadLayoutFromJson(data: object\|string)`| 直接加载 layout JSON       |
| `loadMarkdown(text: string)`            | 直接加载 markdown 文本      |

### 支持的 JSON 格式

| 格式                | 结构                               | 坐标系   |
|---------------------|------------------------------------|----------|
| `layout.json`       | `{ pdf_info: [{ preproc_blocks }] }` | 左上角   |
| `middle.json`       | `{ pdf_info: [{ preproc_blocks }] }` | 左上角   |
| `content_list.json` | `[{ page_idx, bbox, text }]`       | 0–1000   |

### 许可证

MIT
