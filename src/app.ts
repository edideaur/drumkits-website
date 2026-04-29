import Fuse from 'fuse.js'

interface Kit {
  title: string
  description?: string
  author?: string
  download?: string
  file_size?: string
  category?: string
  source_db: string
  categories?: string[]
  genres?: string[]
}

declare global {
  interface Window {
    plausible?: (event: string, options?: { props: Record<string, string> }) => void
  }
}

const PAGE = 100
const PAGE_ANIM_DELAY_MS = 8
const RENDER_DEBOUNCE_MS = 250
const DB_NAME = 'drumkits'
const DB_VERSION = 2
const DB_STORE = 'kits'
const DB_KEY = 'all'
const SETTINGS_KEY = 'drumkits_settings'
const FAVES_KEY = 'drumkits_faves'
const MANIFEST_KEY = 'drumkits_manifest'

const SVG_FAVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
const SVG_FAVE_EMPTY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
const SVG_DOWNLOAD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'

const KBD_ARROW_UP = 'ArrowUp'
const KBD_ARROW_DOWN = 'ArrowDown'
const KBD_ENTER = 'Enter'

let loadingEl: HTMLElement | null = null

interface Settings {
  theme: 'dark' | 'light' | 'system'
  accent: string
  noTrack: boolean
  pdBypass: boolean
}

let allKits: Kit[] = []
let filtered: Kit[] = []
let shown = 0
let activeCategory = 'ALL'
let activeSource = 'ALL'
let activeFave = 'ALL'
let fuse: Fuse<Kit> | null = null
let faves: Set<string> = new Set()
let settings: Settings = {
  theme: 'dark',
  accent: '#c8ff00',
  noTrack: false,
  pdBypass: true,
}

function track(event: string, props?: Record<string, string>): void {
  if (settings.noTrack) return
  if (typeof window.plausible === 'function') {
    window.plausible(event, { props: props ?? {} })
  }
}

function loadSettings(): void {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY)
    if (saved) settings = { ...settings, ...JSON.parse(saved) }
  } catch {}
  applySettings()
}

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function loadFaves(): void {
  try {
    const saved = localStorage.getItem(FAVES_KEY)
    if (saved) faves = new Set(JSON.parse(saved))
  } catch {}
}

function saveFaves(): void {
  localStorage.setItem(FAVES_KEY, JSON.stringify([...faves]))
}

function toggleFave(url: string): void {
  const isFave = faves.has(url)
  if (isFave) faves.delete(url)
  else faves.add(url)
  saveFaves()
  track('fave_toggle', { url: url.split('/').pop() ?? 'unknown', action: faves.has(url) ? 'add' : 'remove' })
  buildFavesFilter()
  updateFaveButton(url, faves.has(url))
  if (activeFave !== 'ALL') {
    const row = document.querySelector(`.kit-row[data-url="${CSS.escape(url)}"]`)
    if (row) row.remove()
    const remaining = document.querySelectorAll('#list .kit-row').length
    const btn = document.getElementById('load-more')!
    if (remaining === 0 && activeFave === 'FAVE') {
      document.getElementById('empty')!.style.display = 'block'
      btn.style.display = 'none'
    }
  }
}

function updateFaveButton(url: string, isFave: boolean): void {
  const row = document.querySelector(`.kit-row[data-url="${CSS.escape(url)}"]`)
  if (!row) return
  const btn = row.querySelector('.fave-btn') as HTMLButtonElement
  btn.classList.toggle('active', isFave)
  btn.innerHTML = isFave ? SVG_FAVE : SVG_FAVE_EMPTY
  btn.setAttribute('aria-label', isFave ? 'Remove from favorites' : 'Add to favorites')
}

function buildFavesFilter(): void {
  const hasFaves = faves.size > 0
  const btns = [
    { label: 'All', value: 'ALL' },
    ...(hasFaves ? [{ label: 'Favorites', value: 'FAVE' }] : []),
  ]
  const wrap = document.getElementById('fav-filters')!
  wrap.innerHTML = ''
  btns.forEach(btn => {
    const el = document.createElement('button')
    el.className = 'filter-btn' + (activeFave === btn.value ? ' active' : '')
    el.textContent = btn.label
    el.onclick = () => {
      activeFave = activeFave === btn.value ? 'ALL' : btn.value
      document.querySelectorAll('#fav-filters .filter-btn').forEach(b => b.classList.remove('active'))
      if (activeFave === 'ALL') wrap.children[0]?.classList.add('active')
      else wrap.children[1]?.classList.add('active')
      track('filter_fave', { filter: activeFave })
      render()
    }
    wrap.appendChild(el)
  })
}

function applySettings(): void {
  document.documentElement.style.setProperty('--accent', settings.accent)
  document.documentElement.style.setProperty('--accent-dim', settings.accent + '15')
  document.documentElement.style.setProperty('--accent-glow', settings.accent + '30')
  document.documentElement.style.scrollBehavior = 'smooth'
  
  const isDark = settings.theme === 'system' 
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : settings.theme === 'dark'
  document.documentElement.classList.toggle('light-mode', !isDark)
  document.documentElement.classList.toggle('dark-mode', isDark)

  if (settings.theme === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings)
  } else {
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', applySettings)
  }
  
  if (!isDark) {
    let accent = settings.accent
    if (accent === '#c8ff00') accent = '#228800'
    else if (accent === '#00ff00') accent = '#00aa00'
    document.documentElement.style.setProperty('--accent', accent)
    document.documentElement.style.setProperty('--accent-dim', 'rgba(34,136,0,0.1)')
    document.documentElement.style.setProperty('--accent-glow', 'rgba(34,136,0,0.2)')
  }
  
  const t = document.getElementById('setting-theme') as HTMLSelectElement
  const a = document.getElementById('setting-accent') as HTMLInputElement
  const nt = document.getElementById('setting-no-track') as HTMLInputElement
  const pd = document.getElementById('setting-pd-bypass') as HTMLInputElement
  if (t) t.value = settings.theme
  if (a) a.value = settings.accent
  if (nt) nt.checked = settings.noTrack
  if (pd) pd.checked = settings.pdBypass
}

function initSettingsPanel(): void {
  const toggle = document.getElementById('settings-toggle')!
  const panel = document.getElementById('settings-panel')!
  const overlay = document.getElementById('settings-overlay')!
  
  const close = () => { panel.hidden = true }
  const open = () => { panel.hidden = false }
  
  toggle.addEventListener('click', () => {
    panel.hidden ? open() : close()
    track('settings_open', { open: String(!panel.hidden) })
  })
  
  overlay.addEventListener('click', close)
  document.getElementById('settings-close')!.addEventListener('click', close)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close() })
  
  document.getElementById('setting-theme')!.addEventListener('change', e => {
    settings.theme = (e.target as HTMLSelectElement).value as Settings['theme']
    saveSettings()
    applySettings()
    track('settings_change', { key: 'theme', value: settings.theme })
  })
  
  document.getElementById('setting-accent')!.addEventListener('input', e => {
    settings.accent = (e.target as HTMLInputElement).value
    saveSettings()
    applySettings()
})
  
  document.getElementById('setting-no-track')!.addEventListener('change', e => {
    settings.noTrack = (e.target as HTMLInputElement).checked
    saveSettings()
    applySettings()
    track('settings_change', { key: 'noTrack', value: String(settings.noTrack) })
  })

  const pdBypassInput = document.getElementById('setting-pd-bypass') as HTMLInputElement
  pdBypassInput.addEventListener('change', e => {
    settings.pdBypass = (e.target as HTMLInputElement).checked
    saveSettings()
    track('settings_change', { key: 'pdBypass', value: String(settings.pdBypass) })
  })

  document.getElementById('clear-cache')!.addEventListener('click', async () => {
    localStorage.removeItem(MANIFEST_KEY)
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
    track('clear_cache')
    location.reload()
  })
  
  document.getElementById('clear-all')!.addEventListener('click', async () => {
    if (!confirm('This will clear all cached kits, favorites, and settings. Are you sure?')) return
    const req = indexedDB.deleteDatabase(DB_NAME)
    localStorage.clear()
    req.onsuccess = () => {
      track('clear_all')
      location.reload()
    }
  })
  
  document.getElementById('export-data')!.addEventListener('click', () => {
    const data = JSON.stringify({ kits: allKits, settings, faves: [...faves] }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `drumkits-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    track('export_data')
  })
  
  document.getElementById('import-data')!.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        const data = JSON.parse(text)
        if (data.kits && Array.isArray(data.kits)) {
          allKits = data.kits
          await idbSave(allKits)
          if (data.faves && Array.isArray(data.faves)) {
            faves = new Set(data.faves)
            saveFaves()
          }
          buildFuse()
          buildFilters()
          buildFavesFilter()
          filtersBuilt = true
          render()
          track('import_data', { count: String(data.kits.length) })
          alert(`Imported ${data.kits.length} kits successfully!`)
        } else {
          alert('Invalid data format: missing kits array')
        }
      } catch (e) {
        alert('Failed to parse JSON file')
      }
    }
    input.click()
  })
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
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
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite')
      const req = tx.objectStore(DB_STORE).put(data, DB_KEY)
      req.onsuccess = () => resolve()
      req.onerror = reject
    })
  } catch {}
}

let filtersBuilt = false

async function init(): Promise<void> {
  showLoading('Loading kits...')
  const cached = await idbLoad()
  const storedManifest = localStorage.getItem(MANIFEST_KEY)
  
  try {
    const manifestRes = await fetch('kits-manifest.json')
    const manifest = await manifestRes.json()
    const needsUpdate = !storedManifest || storedManifest !== manifest.hash
    
    if (cached && !needsUpdate) {
      allKits = cached
      buildFuse()
      buildFilters()
      buildFavesFilter()
      filtersBuilt = true
      hideLoading()
      render()
      return
    }
    
    if (needsUpdate) {
      localStorage.setItem(MANIFEST_KEY, manifest.hash)
    }
  } catch {
    if (cached) {
      allKits = cached
      buildFuse()
      buildFilters()
      buildFavesFilter()
      filtersBuilt = true
      hideLoading()
      render()
      return
    }
  }
  
  await streamKits()
}

async function streamKits(): Promise<void> {
  showLoading('Fetching kits...')
  const res = await fetch('kits.ndjson')
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let loadedCount = 0

  const scheduleRender = () => {
    if (timer) return
    timer = setTimeout(() => { 
      timer = null
      showLoading(`Loading kits... (${loadedCount})`)
      render()
    }, RENDER_DEBOUNCE_MS)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const line of lines) {
      if (line) {
        allKits.push(JSON.parse(line) as Kit)
        loadedCount++
      }
    }
    scheduleRender()
  }

  if (buf.trim()) allKits.push(JSON.parse(buf) as Kit)
  clearTimeout(timer!)
  buildFuse()
  buildFilters()
  filtersBuilt = true
  hideLoading()
  render()
  await idbSave(allKits)
}

function buildFuse(): void {
  fuse = new Fuse(allKits, {
    keys: ['title', 'description', 'author', 'categories', 'genres'],
    threshold: 0.35,
    minMatchCharLength: 2,
    ignoreLocation: true,
  })
}

function buildFilters(): void {
  if (filtersBuilt) return
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
  const newCat = activeCategory === cat ? 'ALL' : cat
  activeCategory = newCat
  document.querySelectorAll('#filters .filter-btn').forEach(b => b.classList.remove('active'))
  if (newCat !== 'ALL') btn.classList.add('active')
  else document.querySelector('#filters .filter-btn')?.classList.add('active')
  track('filter_category', { category: newCat })
  render()
}

function setSource(src: string, btn: HTMLButtonElement): void {
  const newSrc = activeSource === src ? 'ALL' : src
  activeSource = newSrc
  document.querySelectorAll('#source-filters .filter-btn').forEach(b => b.classList.remove('active'))
  if (newSrc !== 'ALL') btn.classList.add('active')
  else document.querySelector('#source-filters .filter-btn')?.classList.add('active')
  track('filter_source', { source: newSrc })
  render()
}

let debounceTimer: ReturnType<typeof setTimeout>
document.getElementById('search')!.addEventListener('input', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const q = (document.getElementById('search') as HTMLInputElement).value.trim()
    if (q) track('search', { query: q, category: activeCategory, source: activeSource })
    render()
  }, 120)
})

document.getElementById('search-clear')!.addEventListener('click', () => {
  (document.getElementById('search') as HTMLInputElement).value = ''
  track('search_clear')
  render()
})

const sentinel = document.getElementById('load-more')!
new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && shown < filtered.length) {
    track('load_more', { shown: String(shown), remaining: String(filtered.length - shown) })
    loadMore()
  }
}, { rootMargin: '200px' }).observe(sentinel)

function render(): void {
  const q = (document.getElementById('search') as HTMLInputElement).value.trim()

  let base: Kit[]
  if (q && fuse) {
    base = fuse.search(q).map(r => r.item)
  } else if (q) {
    const ql = q.toLowerCase()
    base = allKits.filter(k => {
      const hay = [k.title, k.description, k.author, ...(k.categories ?? []), ...(k.genres ?? [])].join(' ')
      return hay.toLowerCase().includes(ql)
    })
  } else {
    base = allKits
  }

  const catFiltered = activeCategory === 'ALL' ? base : base.filter(k => k.category === activeCategory)
  const srcFiltered = activeSource === 'ALL' ? catFiltered : catFiltered.filter(k => k.source_db === activeSource)
  filtered = activeFave === 'ALL' ? srcFiltered : srcFiltered.filter(k => faves.has(k.download))
  shown = 0
  document.getElementById('list')!.innerHTML = ''
  document.getElementById('count')!.textContent = filtered.length.toLocaleString() + ' kits'
  document.getElementById('empty')!.style.display = filtered.length ? 'none' : 'block'
  track('render', { total: String(filtered.length), category: activeCategory, source: activeSource })
  loadMore()
}

function loadMore(): void {
  const list = document.getElementById('list')!
  const slice = filtered.slice(shown, shown + PAGE)
  slice.forEach((kit, i) => {
    const a = document.createElement('div')
    a.className = 'kit-row'
    a.dataset.url = kit.download
    a.style.animationDelay = `${i * PAGE_ANIM_DELAY_MS}ms`
    const isFave = faves.has(kit.download)
    a.innerHTML = `
      <div class="kit-left">
        <div class="kit-title">${esc(kit.title)}</div>
        ${(kit.author || kit.file_size) ? `<div class="kit-desc">${[kit.author, kit.file_size].filter((x): x is string => !!x).map(esc).join(' · ')}</div>` : kit.description ? `<div class="kit-desc">${esc(kit.description)}</div>` : ''}
      </div>
      <div class="kit-right">
        ${kit.category ? `<span class="badge badge-cat">${esc(kit.category)}</span>` : ''}
        <span class="badge badge-src-${esc(kit.source_db)}">${esc(kit.source_db)}</span>
        <button class="fave-btn${isFave ? ' active' : ''}" aria-label="${isFave ? 'Remove from favorites' : 'Add to favorites'}">
          ${isFave ? SVG_FAVE : SVG_FAVE_EMPTY}
        </button>
        <a class="open-link" href="${kit.download || '#'}" rel="noopener noreferrer" aria-label="Download">
          ${SVG_DOWNLOAD}
        </a>
      </div>`
    const favBtn = a.querySelector('.fave-btn')!
    favBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleFave(kit.download) })
    const link = a.querySelector('.open-link') as HTMLAnchorElement
    if (kit.download) {
      a.style.cursor = 'pointer'
      a.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.fave-btn')) return
        e.preventDefault()
        downloadFile(kit.download)
      })
    } else {
      link.style.pointerEvents = 'none'
      link.style.opacity = '0.3'
    }
    list.appendChild(a)
  })
  shown += slice.length
  const btn = document.getElementById('load-more')!
  btn.style.display = shown < filtered.length ? 'block' : 'none'
  if (shown < filtered.length)
    btn.textContent = `Load more (${(filtered.length - shown).toLocaleString()} remaining)`
}

async function downloadFile(url: string): Promise<void> {
  const isExternal = !url.startsWith('https://r2.gangsloni.com')
  const source = isExternal ? 'external' : 'r2'
  track('download', { source, kit: url, filename: url.split('/').pop() ?? 'unknown' })
  
  if (url.startsWith('https://r2.gangsloni.com')) {
    try {
      const key = url.split('https://r2.gangsloni.com/')[1]
      const r = await fetch(`https://api.g-meh.com/getURL?key=${key}`)
      const json = await r.json()
      window.open(json.url, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } else if (url.includes('disk.yandex') || url.includes('yadi.sk')) {
    try {
      let publicKey = url
      if (url.includes('yadi.sk')) {
        publicKey = 'https://yadi.sk/d/' + url.split('yadi.sk/d/')[1].split('?')[0]
      } else if (url.includes('disk.yandex.com')) {
        publicKey = 'https://disk.yandex.com/d/' + url.split('disk.yandex.com/d/')[1].split('?')[0]
      } else if (url.includes('disk.yandex.ru')) {
        publicKey = 'https://disk.yandex.ru/d/' + url.split('disk.yandex.ru/d/')[1].split('?')[0]
      }
      const r = await fetch(`https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(publicKey)}`)
      const json = await r.json()
      if (json.href) {
        window.location.href = json.href
        return
      }
    } catch {}
    window.location.href = url
  } else if (url.includes('dropbox.com') || url.includes('www.dropbox.com')) {
    try {
      const u = new URL(url)
      u.searchParams.set('dl', '1')
      u.searchParams.delete('fbclid')
      u.searchParams.delete('st')
      u.searchParams.delete('e')
      window.open(u.toString(), '_blank', 'noopener,noreferrer')
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } else if (url.includes('pixeldrain.com/u/')) {
    const id = url.split('pixeldrain.com/u/')[1].split('?')[0]
    if (settings.pdBypass) {
      const bypassUrl = `https://cdn.pixeldrain.eu.cc/${id}`
      showPdModal(bypassUrl)
    } else {
      const w = window.open(`https://pixeldrain.com/u/${id}`, '_blank')
      if (w) {
        setTimeout(() => {
          w.location.replace(`https://pixeldrain.com/api/file/${id}?download`)
        }, 2000)
      }
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function showPdModal(url: string, title: string = 'PixelDrain Bypass'): void {
  const modal = document.getElementById('pd-modal')!
  const titleEl = modal.querySelector('h3')!
  const urlInput = document.getElementById('pd-modal-url') as HTMLInputElement
  const copyBtn = document.getElementById('pd-modal-copy')!

  titleEl.textContent = title
  urlInput.value = url
  modal.hidden = false
  urlInput.select()

  navigator.clipboard.writeText(url)
  copyBtn.textContent = 'Copied!'
  setTimeout(() => { copyBtn.textContent = 'Copy' }, 2000)

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(url)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => { copyBtn.textContent = 'Copy' }, 2000)
  }

  const close = () => { modal.hidden = true }
  modal.querySelector('.modal-overlay')!.addEventListener('click', close)
  modal.querySelector('.modal-close')!.addEventListener('click', close)
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      close()
      document.removeEventListener('keydown', escHandler)
    }
  })
}

function showLoading(msg: string = 'Loading...'): void {
  if (!loadingEl) {
    loadingEl = document.createElement('div')
    loadingEl.id = 'loading'
    loadingEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg);color:var(--text);padding:20px 40px;border-radius:8px;z-index:1000;font-size:18px;'
    document.body.appendChild(loadingEl)
  }
  loadingEl.textContent = msg
  loadingEl.hidden = false
}

function hideLoading(): void {
  if (loadingEl) loadingEl.hidden = true
}

loadSettings()
loadFaves()
initSettingsPanel()
init().then(() => track('page_load', { kits_loaded: String(allKits.length) }))

const unloadHandler = () => track('page_unload')
addEventListener('pagehide', unloadHandler, { once: true })

let selectedIndex = -1

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement
  const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
  
  if (inInput) return
  
  const rows = document.querySelectorAll<HTMLElement>('#list .kit-row')
  
  if (rows.length === 0) return

  if (e.key === KBD_ARROW_DOWN) {
    e.preventDefault()
    if (selectedIndex < rows.length - 1) {
      if (selectedIndex >= 0) rows[selectedIndex].classList.remove('selected')
      selectedIndex++
      rows[selectedIndex].classList.add('selected')
      rows[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } else if (shown < filtered.length) {
      loadMore()
      setTimeout(() => {
        const newRows = document.querySelectorAll<HTMLElement>('#list .kit-row')
        if (selectedIndex < newRows.length - 1) {
          if (selectedIndex >= 0) newRows[selectedIndex].classList.remove('selected')
          selectedIndex = newRows.length - 1
          newRows[selectedIndex].classList.add('selected')
          newRows[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }, 0)
    }
    return
  }
  
  if (e.key === KBD_ARROW_UP) {
    e.preventDefault()
    if (selectedIndex > 0) {
      rows[selectedIndex].classList.remove('selected')
      selectedIndex--
      rows[selectedIndex].classList.add('selected')
      rows[selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } else if (selectedIndex === 0) {
      rows[0].classList.remove('selected')
      selectedIndex = -1
    }
    return
  }
  
  if (e.key === KBD_ENTER && selectedIndex >= 0) {
    e.preventDefault()
    const row = rows[selectedIndex]
    const link = row?.querySelector('.open-link') as HTMLAnchorElement
    if (link && link.href && link.href !== window.location.href + '#') {
      downloadFile(link.href)
    }
    return
  }
})