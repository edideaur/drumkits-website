import Fuse from 'fuse.js'

interface Kit {
  title: string
  category: string
  download: string
  description: string
  source_db: string
}

const PAGE = 100
const DB_NAME = 'drumkits'
const DB_STORE = 'kits'
const DB_KEY = 'all'

let allKits: Kit[] = []
let filtered: Kit[] = []
let shown = 0
let activeCategory = 'ALL'
let activeSource = 'ALL'
let fuse: Fuse<Kit> | null = null

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = e => (e.target as IDBOpenDBRequest).result.createObjectStore(DB_STORE)
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror = reject
  })
}

async function idbLoad(): Promise<Kit[] | null> {
  try {
    const db = await idbOpen()
    return new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY)
      req.onsuccess = e => resolve((e.target as IDBRequest).result ?? null)
      req.onerror = reject
    })
  } catch { return null }
}

async function idbSave(data: Kit[]): Promise<void> {
  try {
    const db = await idbOpen()
    db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(data, DB_KEY)
  } catch {}
}

async function init(): Promise<void> {
  const cached = await idbLoad()
  if (cached) {
    allKits = cached
    buildFuse()
    buildFilters()
    render()
    return
  }
  await streamKits()
}

async function streamKits(): Promise<void> {
  const res = await fetch('kits.ndjson')
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleRender = () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; render() }, 250)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const line of lines) {
      if (line) allKits.push(JSON.parse(line) as Kit)
    }
    scheduleRender()
  }

  if (buf.trim()) allKits.push(JSON.parse(buf) as Kit)
  clearTimeout(timer!)
  buildFuse()
  buildFilters()
  render()
  idbSave(allKits)
}

function buildFuse(): void {
  fuse = new Fuse(allKits, {
    keys: ['title', 'description'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true,
  })
}

function buildFilters(): void {
  const cats = ['ALL', ...[...new Set(allKits.map(k => k.category).filter(Boolean))].sort()]
  const wrap = document.getElementById('filters')!
  wrap.innerHTML = ''
  cats.forEach(cat => {
    const btn = document.createElement('button')
    btn.className = 'filter-btn' + (cat === activeCategory ? ' active' : '')
    btn.textContent = cat === 'ALL' ? 'All' : cat
    btn.onclick = () => setCategory(cat, btn)
    wrap.appendChild(btn)
  })

  const srcs = ['ALL', ...[...new Set(allKits.map(k => k.source_db).filter(Boolean))].sort()]
  const srcWrap = document.getElementById('source-filters')!
  srcWrap.innerHTML = ''
  srcs.forEach(src => {
    const btn = document.createElement('button')
    btn.className = 'filter-btn' + (src === activeSource ? ' active' : '')
    btn.textContent = src === 'ALL' ? 'All sources' : src.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    btn.onclick = () => setSource(src, btn)
    srcWrap.appendChild(btn)
  })
}

function setCategory(cat: string, btn: HTMLButtonElement): void {
  activeCategory = cat
  document.querySelectorAll('#filters .filter-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  render()
}

function setSource(src: string, btn: HTMLButtonElement): void {
  activeSource = src
  document.querySelectorAll('#source-filters .filter-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  render()
}

let debounceTimer: ReturnType<typeof setTimeout>
document.getElementById('search')!.addEventListener('input', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(render, 120)
})

document.getElementById('search-clear')!.addEventListener('click', () => {
  (document.getElementById('search') as HTMLInputElement).value = ''
  render()
})

document.getElementById('load-more')!.addEventListener('click', loadMore)

function render(): void {
  const q = (document.getElementById('search') as HTMLInputElement).value.trim()

  let base: Kit[]
  if (q && fuse) {
    base = fuse.search(q).map(r => r.item)
  } else if (q) {
    const ql = q.toLowerCase()
    base = allKits.filter(k =>
      (k.title + ' ' + k.description).toLowerCase().includes(ql)
    )
  } else {
    base = allKits
  }

  const catFiltered = activeCategory === 'ALL' ? base : base.filter(k => k.category === activeCategory)
  filtered = activeSource === 'ALL' ? catFiltered : catFiltered.filter(k => k.source_db === activeSource)
  shown = 0
  document.getElementById('list')!.innerHTML = ''
  document.getElementById('count')!.textContent = filtered.length.toLocaleString() + ' kits'
  document.getElementById('empty')!.style.display = filtered.length ? 'none' : 'block'
  loadMore()
}

function loadMore(): void {
  const list = document.getElementById('list')!
  const slice = filtered.slice(shown, shown + PAGE)
  slice.forEach((kit, i) => {
    const a = document.createElement('a')
    a.className = 'kit-row'
    a.href = kit.download || '#'
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.style.animationDelay = `${i * 8}ms`
    a.innerHTML = `
      <div class="kit-left">
        <div class="kit-title">${esc(kit.title)}</div>
        ${kit.description ? `<div class="kit-desc">${esc(kit.description)}</div>` : ''}
      </div>
      <div class="kit-right">
        ${kit.category ? `<span class="badge badge-cat">${esc(kit.category)}</span>` : ''}
        <span class="badge badge-src-${esc(kit.source_db)}">${esc(kit.source_db)}</span>
        <span class="open-icon">↗</span>
      </div>`
    list.appendChild(a)
  })
  shown += slice.length
  const btn = document.getElementById('load-more')!
  btn.style.display = shown < filtered.length ? 'block' : 'none'
  if (shown < filtered.length)
    btn.textContent = `Load more (${(filtered.length - shown).toLocaleString()} remaining)`
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

init()
