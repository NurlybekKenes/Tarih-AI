import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { copyFor, type Language } from './i18n'

type Source = { id: string; title: string; author: string; publisher: string; url: string; language: string; reliability_note: string; origin?: 'local-library' | 'local-document' | 'web'; checked_at?: string | null }
type DocumentResult = { source_id: string; chunk_index: number; title: string; publisher: string; language: string; excerpt: string }
type ManagedDocument = { id: string; slug: string; title: string; filename: string; language: Language; created_at: string; chunks: number }
type AdminEvent = {
  id: number; slug: string; date_from: string; date_to: string; date_precision: string; category: string; status: string; period_slug: string | null;
  title_kk: string; title_ru: string; summary_kk: string; summary_ru: string; body_kk: string; body_ru: string; source_ids: string[]
}
type EventRevisionDraft = Omit<AdminEvent, 'id' | 'slug' | 'status' | 'source_ids'> & { source_ids: string }
type EventRevision = { id: number; review_status: 'pending' | 'in_review' | 'changes_requested' | 'approved'; reviewer_notes: string; created_at: string; reviewed_at: string | null; payload: EventRevisionDraft & { source_ids: string[] } }
type HistoricalEvent = {
  slug: string; date_from: string; date_to: string; date_precision: string; category: string;
  title: string; summary: string; body: string; translation_fallback?: boolean; sources: Source[]
}
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; sources?: Source[]; mode?: string; insufficient?: boolean; webUnavailable?: boolean }

const API = ''

function eventDate(event: HistoricalEvent, language: Language) {
  if (event.slug === 'tanbaly-petroglyphs') return language === 'kk' ? 'Қола дәуірінен · шамамен' : 'С бронзового века · примерно'
  if (event.slug === 'kazakhstan-independence') return language === 'kk' ? '1991 жылғы 16 желтоқсан' : '16 декабря 1991 г.'
  if (event.date_precision === 'year-range') {
    const start = event.date_from.slice(0, 4)
    const end = event.date_to.slice(0, 4)
    return language === 'kk' ? `${start}–${end} жылдары` : `${start}–${end} гг.`
  }
  if (event.date_precision === 'day-range') {
    const format = (value: string) => new Intl.DateTimeFormat(language === 'kk' ? 'kk-KZ' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
    return `${format(event.date_from)} — ${format(event.date_to)}`
  }
  const date = new Date(`${event.date_from}T00:00:00Z`)
  return new Intl.DateTimeFormat(language === 'kk' ? 'kk-KZ' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function checkedDate(value: string, language: Language) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return new Intl.DateTimeFormat(language === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'medium', timeZone: 'Asia/Qyzylorda' }).format(parsed)
}

function renderAnswer(text: string, sources: Source[] = []) {
  return text.split(/(\*\*[^*]+?\*\*|\[W\d+\])/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    const citation = /^\[W(\d+)\]$/.exec(part)
    if (citation) {
      const source = sources.find((item) => item.origin === 'web' && item.id === `web-${citation[1]}`)
      if (source?.url && /^https?:\/\//i.test(source.url)) {
        return <a className="answer-citation" href={source.url} target="_blank" rel="noreferrer" aria-label={`Открыть источник ${part}`} key={index}>{part}</a>
      }
    }
    return part
  })
}

function revisionDraftFromEvent(item: AdminEvent): EventRevisionDraft {
  return {
    date_from: item.date_from, date_to: item.date_to, date_precision: item.date_precision, category: item.category, period_slug: item.period_slug,
    title_kk: item.title_kk, title_ru: item.title_ru, summary_kk: item.summary_kk, summary_ru: item.summary_ru,
    body_kk: item.body_kk, body_ru: item.body_ru, source_ids: item.source_ids.join(', '),
  }
}

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('tarih-language') === 'kk' ? 'kk' : 'ru'))
  const [events, setEvents] = useState<HistoricalEvent[]>([])
  const [documents, setDocuments] = useState<DocumentResult[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<HistoricalEvent | null>(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('tarih-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState(false)
  const [researchScope, setResearchScope] = useState<'local' | 'web' | 'combined'>('combined')
  const [adminToken, setAdminToken] = useState('')
  const [managedDocuments, setManagedDocuments] = useState<ManagedDocument[]>([])
  const [adminEvents, setAdminEvents] = useState<AdminEvent[]>([])
  const [selectedAdminSlug, setSelectedAdminSlug] = useState('')
  const [revisionDraft, setRevisionDraft] = useState<EventRevisionDraft | null>(null)
  const [eventRevisions, setEventRevisions] = useState<EventRevision[]>([])
  const [reviewerNotes, setReviewerNotes] = useState('')
  const [savingRevision, setSavingRevision] = useState(false)
  const [documentsAdminReady, setDocumentsAdminReady] = useState(false)
  const [documentsAdminLoading, setDocumentsAdminLoading] = useState(false)
  const [documentsAdminError, setDocumentsAdminError] = useState('')
  const [documentsAdminNotice, setDocumentsAdminNotice] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [documentLanguage, setDocumentLanguage] = useState<Language>(language)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const timelineRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const lastMessageRef = useRef<HTMLDivElement>(null)
  const t = useMemo(() => copyFor(language), [language])

  async function loadEvents(search = query) {
    setLoading(true); setLoadError(false)
    try {
      const params = new URLSearchParams({ language })
      if (search.trim()) params.set('q', search.trim())
      const endpoint = search.trim() ? '/api/v1/search' : '/api/v1/events'
      const response = await fetch(`${API}${endpoint}?${params}`)
      if (!response.ok) throw new Error('Could not load events')
      const data: { items: HistoricalEvent[]; documents?: DocumentResult[] } = await response.json()
      setEvents(data.items)
      setDocuments(data.documents ?? [])
    } catch {
      setLoadError(true)
      setDocuments([])
    } finally { setLoading(false) }
  }

  useEffect(() => { localStorage.setItem('tarih-language', language); void loadEvents('') }, [language])
  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadEvents(query) }, 240)
    return () => window.clearTimeout(timeout)
  }, [query, language])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('tarih-theme', theme)
  }, [theme])
  useEffect(() => { lastMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, sending])
  useEffect(() => { if (selected) dialogRef.current?.showModal() }, [selected])

  function changeLanguage(next: Language) {
    if (next === language) return
    setLanguage(next)
    setNotice(next === 'kk' ? 'Тіл қазақшаға ауыстырылды.' : 'Язык переключён на русский.')
    window.setTimeout(() => setNotice(''), 2500)
  }

  function openGuide() { document.getElementById('guide')?.scrollIntoView({ behavior: 'smooth' }); window.setTimeout(() => questionRef.current?.focus(), 350) }

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if (!text || sending) return
    setMessages((current) => [...current, { id: Date.now(), role: 'user', text }])
    setQuestion(''); setSending(true); setChatError(false)
    try {
      const response = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, language, research_scope: researchScope }) })
      if (!response.ok) throw new Error('Chat request failed')
      const data: { answer: string; sources: Source[]; mode: string; insufficient_data: boolean; web_search_unavailable?: boolean } = await response.json()
      setMessages((current) => [...current, { id: Date.now() + 1, role: 'assistant', text: data.answer, sources: data.sources, mode: data.mode, insufficient: data.insufficient_data, webUnavailable: data.web_search_unavailable }])
    } catch { setChatError(true) } finally { setSending(false) }
  }

  async function loadManagedDocuments(token = adminToken) {
    if (!token.trim()) { setDocumentsAdminError(t.tokenError); return }
    setDocumentsAdminLoading(true); setDocumentsAdminError(''); setDocumentsAdminNotice('')
    try {
      const headers = { Authorization: `Bearer ${token.trim()}` }
      const [documentsResponse, eventsResponse] = await Promise.all([
        fetch(`${API}/api/v1/documents`, { headers }), fetch(`${API}/api/v1/admin/events`, { headers }),
      ])
      if (!documentsResponse.ok || !eventsResponse.ok) throw new Error('Could not load admin content')
      const [documentsData, eventsData]: [{ items: ManagedDocument[] }, { items: AdminEvent[] }] = await Promise.all([documentsResponse.json(), eventsResponse.json()])
      setManagedDocuments(documentsData.items); setAdminEvents(eventsData.items); setDocumentsAdminReady(true)
      const currentEvent = eventsData.items.find((item) => item.slug === selectedAdminSlug)
      if (currentEvent) setRevisionDraft(revisionDraftFromEvent(currentEvent))
    } catch { setDocumentsAdminError(t.documentsError); setDocumentsAdminReady(false) }
    finally { setDocumentsAdminLoading(false) }
  }

  async function loadEventRevisions(slug: string, token = adminToken) {
    try {
      const response = await fetch(`${API}/api/v1/admin/events/${slug}/revisions`, { headers: { Authorization: `Bearer ${token.trim()}` } })
      if (!response.ok) throw new Error('Could not load event revisions')
      const data: { items: EventRevision[] } = await response.json()
      setEventRevisions(data.items)
      setReviewerNotes(data.items.find((item) => item.review_status === 'in_review')?.reviewer_notes ?? '')
    } catch { setDocumentsAdminError(t.documentsError); setEventRevisions([]) }
  }

  function selectAdminEvent(slug: string) {
    setSelectedAdminSlug(slug); setEventRevisions([]); setReviewerNotes('')
    const item = adminEvents.find((event) => event.slug === slug)
    setRevisionDraft(item ? revisionDraftFromEvent(item) : null)
    if (slug) void loadEventRevisions(slug)
  }

  async function submitEventRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!revisionDraft || !selectedAdminSlug) return
    setSavingRevision(true); setDocumentsAdminError(''); setDocumentsAdminNotice('')
    try {
      const payload = { ...revisionDraft, source_ids: revisionDraft.source_ids.split(',').map((id) => id.trim()).filter(Boolean) }
      const response = await fetch(`${API}/api/v1/admin/events/${selectedAdminSlug}/revisions`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminToken.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('Could not submit event revision')
      setDocumentsAdminNotice(t.revisionSaved); await loadEventRevisions(selectedAdminSlug)
    } catch { setDocumentsAdminError(t.revisionSaveError) }
    finally { setSavingRevision(false) }
  }

  async function setRevisionReviewStatus(revision: EventRevision, reviewStatus: 'in_review' | 'changes_requested' | 'approved') {
    setDocumentsAdminError(''); setDocumentsAdminNotice('')
    try {
      const response = await fetch(`${API}/api/v1/admin/event-revisions/${revision.id}/review`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${adminToken.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: reviewStatus, reviewer_notes: reviewerNotes }),
      })
      if (!response.ok) throw new Error('Could not update review status')
      setDocumentsAdminNotice(reviewStatus === 'approved' ? t.revisionApproved : reviewStatus === 'in_review' ? t.revisionReviewStarted : t.revisionChangesRequestSaved)
      await loadEventRevisions(selectedAdminSlug)
      if (reviewStatus === 'approved') { await loadManagedDocuments(); setDocumentsAdminNotice(t.revisionApproved) }
    } catch { setDocumentsAdminError(t.revisionReviewError) }
  }

  async function importDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adminToken.trim()) { setDocumentsAdminError(t.tokenError); return }
    if (!selectedFile) return
    const suffix = selectedFile.name.toLowerCase().split('.').pop()
    if (!['txt', 'md'].includes(suffix ?? '') || selectedFile.size > 1_000_000) { setDocumentsAdminError(t.uploadError); return }
    const slug = `doc-${Date.now()}`
    const params = new URLSearchParams({ filename: selectedFile.name, language: documentLanguage })
    setUploadingDocument(true); setDocumentsAdminError(''); setDocumentsAdminNotice('')
    try {
      const response = await fetch(`${API}/api/v1/documents/${slug}?${params}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${adminToken.trim()}`, 'Content-Type': 'text/plain; charset=utf-8' }, body: await selectedFile.arrayBuffer(),
      })
      if (!response.ok) throw new Error('Could not import document')
      setDocumentsAdminNotice(t.uploadSuccess); setSelectedFile(null)
      const input = document.getElementById('document-file') as HTMLInputElement | null
      if (input) input.value = ''
      await loadManagedDocuments()
    } catch { setDocumentsAdminError(t.uploadError) }
    finally { setUploadingDocument(false) }
  }

  async function removeDocument(slug: string) {
    setDocumentsAdminError(''); setDocumentsAdminNotice('')
    try {
      const response = await fetch(`${API}/api/v1/documents/${slug}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken.trim()}` } })
      if (!response.ok) throw new Error('Could not delete document')
      setManagedDocuments((current) => current.filter((item) => item.slug !== slug)); setDeleteCandidate(null)
    } catch { setDocumentsAdminError(t.documentsError) }
  }

  function usePrompt(text: string) { setQuestion(text); questionRef.current?.focus() }
  function handleDialogKey(event: KeyboardEvent<HTMLDialogElement>) { if (event.key === 'Escape') setSelected(null) }

  const featured = events.find((event) => event.slug === 'kazakhstan-independence') ?? events[0]
  const activeRevision = eventRevisions.find((revision) => revision.review_status === 'in_review' || revision.review_status === 'pending')

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Тарих / Tarih — на главную"><span className="brand-mark" aria-hidden="true">т</span><span>Тарих <i>/</i> Tarih</span></a>
      <nav className="main-nav" aria-label={language === 'kk' ? 'Негізгі навигация' : 'Основная навигация'}>
        <a href="#timeline">{t.navTimeline}</a><a href="#guide">{t.navGuide}</a><a href="#library-admin">{t.navLibrary}</a>
      </nav>
      <div className="header-actions">
        <div className="language-switch" role="group" aria-label={language === 'kk' ? 'Интерфейс тілі' : 'Язык интерфейса'}>
          <button aria-pressed={language === 'kk'} onClick={() => changeLanguage('kk')}>ҚАЗ</button>
          <span aria-hidden="true">/</span>
          <button aria-pressed={language === 'ru'} onClick={() => changeLanguage('ru')}>РУС</button>
        </div>
        <button className="theme-switch" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? (language === 'kk' ? 'Жарық режим' : 'Светлая тема') : (language === 'kk' ? 'Қараңғы режим' : 'Тёмная тема')} title={theme === 'dark' ? (language === 'kk' ? 'Жарық режим' : 'Светлая тема') : (language === 'kk' ? 'Қараңғы режим' : 'Тёмная тема')}><span aria-hidden="true">{theme === 'dark' ? '☼' : '◐'}</span></button>
      </div>
    </header>
    {notice && <div className="visually-hidden" role="status">{notice}</div>}

    <main id="top">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy"><p className="eyebrow"><span className="eyebrow-rule" />{t.eyebrow}</p>
          <h1 id="hero-title">{t.heroTitle.split('\n').map((line) => <span key={line}>{line}</span>)}</h1>
          <p className="hero-description">{t.heroBody}</p>
          <div className="hero-actions"><a className="button button-primary" href="#timeline">{t.explore}<span aria-hidden="true">↗</span></a><button className="button button-quiet" onClick={openGuide}>{t.askGuide}<span aria-hidden="true">↗</span></button></div>
          <div className="hero-note"><span className="note-seal" aria-hidden="true">✳</span><span>{t.sourceNotice}</span></div>
        </div>
        <div className="hero-art" aria-label={language === 'kk' ? 'Көкжиек пен дала сызықтары' : 'Горизонт и линии степи'} role="img">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-sun" />
          <div className="art-land art-land-back" /><div className="art-land art-land-front" />
          <span className="art-coordinate">43°15′ N &nbsp; 76°57′ E</span><span className="art-caption">QAZAQSTAN<br />ҰЛЫ ДАЛА · GREAT STEPPE</span>
          <span className="art-index">01 — 02</span>
        </div>
      </section>

      {featured && <section className="featured-strip" aria-label={t.record}><span className="featured-label">{t.record}</span><span className="featured-date">{eventDate(featured, language)}</span><span className="featured-title">{featured.title}</span><button className="text-link" onClick={() => setSelected(featured)}>{t.more}<span aria-hidden="true">↗</span></button></section>}

      <section className="timeline-section" id="timeline" ref={timelineRef} aria-labelledby="timeline-title">
        <div className="section-heading"><div><p className="eyebrow"><span className="eyebrow-rule" />{t.record}</p><h2 id="timeline-title">{t.timelineTitle}</h2><p>{t.timelineBody}</p></div>
          <form className="search-form" role="search" onSubmit={(event) => { event.preventDefault(); void loadEvents(query) }}><label htmlFor="event-search">{t.searchLabel}</label><div className="search-control"><span aria-hidden="true">⌕</span><input id="event-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /><button type="button" className="clear-search" aria-label={language === 'kk' ? 'Іздеуді тазалау' : 'Очистить поиск'} onClick={() => setQuery('')} hidden={!query}>×</button></div></form>
        </div>
        <div className="results-line"><span>{t.results}</span>{!loading && <span>{(events.length + documents.length).toString().padStart(2, '0')}</span>}</div>
        {loading && <div className="event-grid" aria-busy="true" aria-label={t.loading}><div className="skeleton-card" /><div className="skeleton-card" /></div>}
        {loadError && !loading && <div className="state-panel" role="alert"><p>{t.loadError}</p><button className="button button-outline" onClick={() => void loadEvents()}>{t.retry}</button></div>}
        {!loading && !loadError && events.length === 0 && documents.length === 0 && <div className="state-panel"><p>{t.noResults}</p><span>{t.noResultsHelp}</span><button className="text-link" onClick={() => setQuery('')}>{t.retry}</button></div>}
        {!loading && !loadError && events.length > 0 && <div className="event-grid">{events.map((event, index) => <article className="event-card" key={event.slug}>
          <div className="event-meta"><span className="event-index">{String(index + 1).padStart(2, '0')}</span><span className="event-date">{eventDate(event, language)}</span><span className="category-pill">{t.categories[event.category as keyof typeof t.categories] ?? event.category}</span></div>
          <h3>{event.title}</h3><p className="event-summary">{event.summary}</p>
          <div className="event-card-footer"><span>{event.sources?.length ?? 0} {t.source}</span><button className="text-link" onClick={() => setSelected(event)}>{t.more}<span aria-hidden="true">↗</span></button></div>
        </article>)}</div>}
        {!loading && !loadError && documents.length > 0 && <section className="document-results" aria-labelledby="document-results-title"><h3 id="document-results-title">{t.documentResults}</h3><div className="document-result-list">{documents.map((document) => <article className="document-result" key={`${document.source_id}-${document.chunk_index}`}><div><strong>{document.title}</strong><span>{document.publisher} · {document.language.toUpperCase()}</span></div><p>{document.excerpt}</p><small>{t.documentImportedNote}</small></article>)}</div></section>}
      </section>

      <section className="library-admin" id="library-admin" aria-labelledby="library-title">
        <div className="library-heading"><p className="eyebrow"><span className="eyebrow-rule" />{t.navLibrary}</p><h2 id="library-title">{t.libraryTitle}</h2><p>{t.libraryBody}</p></div>
        <div className="library-panel">
          <form className="admin-access-form" onSubmit={(event) => { event.preventDefault(); void loadManagedDocuments() }}>
            <div className="field-block"><label htmlFor="admin-token">{t.adminTokenLabel}</label><input id="admin-token" type="password" autoComplete="current-password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} aria-describedby="admin-token-help" /><small id="admin-token-help">{t.adminTokenHelp}</small></div>
            <button className="button button-outline" type="submit" disabled={documentsAdminLoading} aria-busy={documentsAdminLoading}>{documentsAdminLoading ? t.sending : t.openLibrary}</button>
          </form>
          {documentsAdminReady && <>
            <form className="document-upload-form" onSubmit={importDocument}>
              <div className="field-block"><label htmlFor="document-file">{t.chooseDocument}</label><input id="document-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)} /></div>
              <div className="field-block"><label htmlFor="document-language">{t.documentLanguage}</label><select id="document-language" value={documentLanguage} onChange={(event) => setDocumentLanguage(event.target.value as Language)}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></div>
              <button className="button button-primary" type="submit" disabled={uploadingDocument || !selectedFile} aria-busy={uploadingDocument}>{uploadingDocument ? t.sending : t.uploadDocument}</button>
            </form>
            <div className="managed-documents-head"><h3>{t.manageDocuments}</h3><button className="text-link" type="button" onClick={() => void loadManagedDocuments()} disabled={documentsAdminLoading}>{t.refreshDocuments}</button></div>
            {documentsAdminLoading && <p className="admin-status" role="status">{t.loading}</p>}
            {!documentsAdminLoading && managedDocuments.length === 0 && <p className="admin-status">{t.noDocuments}</p>}
            {!!managedDocuments.length && <ul className="managed-document-list">{managedDocuments.map((item) => <li key={item.id}>
              <div><strong>{item.filename}</strong><span>{item.language.toUpperCase()} · {item.chunks} {language === 'kk' ? 'үзінді' : 'фрагм.'} · {t.importedAt}: {checkedDate(item.created_at, language)} · {t.localImported}</span></div>
              {deleteCandidate === item.slug ? <div className="delete-confirm"><span>{t.documentDeleteConfirm}</span><button className="text-link" type="button" onClick={() => void removeDocument(item.slug)}>{t.confirmDelete}</button><button className="text-link" type="button" onClick={() => setDeleteCandidate(null)}>{t.cancelDelete}</button></div> : <button className="text-link delete-action" type="button" onClick={() => setDeleteCandidate(item.slug)}>{t.documentDelete}</button>}
            </li>)}</ul>}
            <section className="event-editorial-admin" aria-labelledby="event-editorial-title">
              <div className="managed-documents-head"><h3 id="event-editorial-title">{t.adminEventsTitle}</h3></div>
              <p className="admin-status">{t.adminEventsHelp}</p>
              <div className="field-block"><label htmlFor="admin-event-select">{t.selectAdminEvent}</label><select id="admin-event-select" value={selectedAdminSlug} onChange={(event) => selectAdminEvent(event.target.value)}><option value="">—</option>{adminEvents.map((item) => <option key={item.slug} value={item.slug}>{language === 'kk' ? item.title_kk : item.title_ru} · {item.slug}</option>)}</select></div>
              {revisionDraft && selectedAdminSlug && <>
                <form className="event-revision-form" onSubmit={submitEventRevision}>
                  <h4>{t.revisionDraftTitle}</h4>
                  <div className="event-revision-grid">
                    <div className="field-block"><label htmlFor="revision-date-from">{t.dateFrom}</label><input id="revision-date-from" value={revisionDraft.date_from} onChange={(event) => setRevisionDraft({ ...revisionDraft, date_from: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-date-to">{t.dateTo}</label><input id="revision-date-to" value={revisionDraft.date_to} onChange={(event) => setRevisionDraft({ ...revisionDraft, date_to: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-date-precision">{t.datePrecision}</label><select id="revision-date-precision" value={revisionDraft.date_precision} onChange={(event) => setRevisionDraft({ ...revisionDraft, date_precision: event.target.value })}><option value="day">{t.dateDay}</option><option value="day-range">{t.dateDayRange}</option><option value="year-range">{t.dateYearRange}</option><option value="approximate-period">{t.dateApproxPeriod}</option></select></div>
                    <div className="field-block"><label htmlFor="revision-category">{t.category}</label><select id="revision-category" value={revisionDraft.category} onChange={(event) => setRevisionDraft({ ...revisionDraft, category: event.target.value })}>{Object.entries(t.categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                    <div className="field-block"><label htmlFor="revision-period">{t.periodSlug}</label><input id="revision-period" value={revisionDraft.period_slug ?? ''} onChange={(event) => setRevisionDraft({ ...revisionDraft, period_slug: event.target.value || null })} /></div>
                    <div className="field-block"><label htmlFor="revision-sources">{t.sourceIds}</label><input id="revision-sources" value={revisionDraft.source_ids} onChange={(event) => setRevisionDraft({ ...revisionDraft, source_ids: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-title-kk">{t.titleKk}</label><input id="revision-title-kk" value={revisionDraft.title_kk} onChange={(event) => setRevisionDraft({ ...revisionDraft, title_kk: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-title-ru">{t.titleRu}</label><input id="revision-title-ru" value={revisionDraft.title_ru} onChange={(event) => setRevisionDraft({ ...revisionDraft, title_ru: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-summary-kk">{t.summaryKk}</label><textarea id="revision-summary-kk" rows={3} value={revisionDraft.summary_kk} onChange={(event) => setRevisionDraft({ ...revisionDraft, summary_kk: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-summary-ru">{t.summaryRu}</label><textarea id="revision-summary-ru" rows={3} value={revisionDraft.summary_ru} onChange={(event) => setRevisionDraft({ ...revisionDraft, summary_ru: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-body-kk">{t.bodyKk}</label><textarea id="revision-body-kk" rows={6} value={revisionDraft.body_kk} onChange={(event) => setRevisionDraft({ ...revisionDraft, body_kk: event.target.value })} required /></div>
                    <div className="field-block"><label htmlFor="revision-body-ru">{t.bodyRu}</label><textarea id="revision-body-ru" rows={6} value={revisionDraft.body_ru} onChange={(event) => setRevisionDraft({ ...revisionDraft, body_ru: event.target.value })} required /></div>
                  </div>
                  <button className="button button-outline" type="submit" disabled={savingRevision} aria-busy={savingRevision}>{savingRevision ? t.sending : t.revisionSubmit}</button>
                </form>
                <div className="event-revision-history"><h4>{t.revisionHistory}</h4>
                  {!eventRevisions.length && <p className="admin-status">{t.noRevisionHistory}</p>}
                  {eventRevisions.map((revision) => <div className="event-revision-row" key={revision.id}><strong>#{revision.id} · {revision.review_status === 'pending' ? t.revisionPending : revision.review_status === 'in_review' ? t.revisionInReview : revision.review_status === 'changes_requested' ? t.revisionChangesRequested : t.revisionStatusApproved}</strong><small>{checkedDate(revision.created_at, language)}</small>{revision.reviewer_notes && <p>{revision.reviewer_notes}</p>}</div>)}
                  {activeRevision && <div className="revision-review-actions"><div className="field-block"><label htmlFor="reviewer-notes">{t.reviewerNotes}</label><textarea id="reviewer-notes" rows={3} value={reviewerNotes} onChange={(event) => setReviewerNotes(event.target.value)} /></div>
                    {activeRevision.review_status === 'pending' ? <button className="button button-outline" type="button" onClick={() => void setRevisionReviewStatus(activeRevision, 'in_review')}>{t.startReview}</button> : <div className="revision-review-buttons"><button className="button button-primary" type="button" onClick={() => void setRevisionReviewStatus(activeRevision, 'approved')}>{t.approveRevision}</button><button className="button button-outline" type="button" onClick={() => void setRevisionReviewStatus(activeRevision, 'changes_requested')}>{t.requestRevisionChanges}</button></div>}
                  </div>}
                </div>
              </>}
            </section>
          </>}
          {documentsAdminError && <p className="admin-error" role="alert">{documentsAdminError}</p>}
          {documentsAdminNotice && <p className="admin-success" role="status">{documentsAdminNotice}</p>}
        </div>
      </section>

      <section className="guide-section" id="guide" aria-labelledby="guide-title">
        <div className="guide-intro"><p className="eyebrow"><span className="eyebrow-rule" />{t.guideEyebrow}</p><h2 id="guide-title">{t.guideTitle}</h2><p>{t.guideBody}</p>
          <div className="prompt-list" aria-label={language === 'kk' ? 'Сұрақ мысалдары' : 'Примеры вопросов'}>{t.prompts.map((prompt) => <button key={prompt} className="prompt-chip" onClick={() => usePrompt(prompt)}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>
        </div>
        <div className="chat-panel"><div className="chat-head"><div className="guide-avatar" aria-hidden="true">т</div><div><strong>Тарих AI</strong><span>{t.sourceNotice}</span></div><span className="online-mark" aria-label={language === 'kk' ? 'Қолжетімді' : 'Доступен'} /></div>
          <fieldset className="research-scope"><legend>{t.researchScope}</legend><label><input type="radio" name="research-scope" value="local" checked={researchScope === 'local'} onChange={() => setResearchScope('local')} />{t.scopeLocal}</label><label><input type="radio" name="research-scope" value="web" checked={researchScope === 'web'} onChange={() => setResearchScope('web')} />{t.scopeWeb}</label><label><input type="radio" name="research-scope" value="combined" checked={researchScope === 'combined'} onChange={() => setResearchScope('combined')} />{t.scopeCombined}</label></fieldset>
          <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
            {messages.length === 0 && <div className="chat-empty"><span className="chat-star" aria-hidden="true">✳</span><p>{language === 'kk' ? 'Оқиғалар, дәуірлер немесе дереккөздер туралы сұраңыз.' : 'Спросите о событиях, эпохах или источниках.'}</p></div>}
            {messages.map((message) => <div className={`message message-${message.role}`} key={message.id}><div className="message-bubble">{renderAnswer(message.text, message.sources)}</div>{message.role === 'assistant' && <>
              {message.insufficient && <p className="insufficient-note">{t.insufficient}</p>}
              <span className="mode-tag">{message.mode === 'demo' ? t.modeDemo : message.mode === 'fallback' ? t.modeFallback : t.modeAi}</span>
              {!!message.sources?.length && <div className="message-sources">
                {message.sources.some((source) => source.origin !== 'web') && <section><span className="source-group-title">{t.sourcesLocal}</span>{message.sources.filter((source) => source.origin !== 'web').map((source) => <div className="chat-source" key={source.id}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.publisher}<span aria-hidden="true">↗</span></a> : <span className="local-source">{source.title} · {t.localImported}</span>}<small>{source.origin === 'local-document' ? t.localImported : t.localCollection}{source.checked_at ? ` · ${t.checkedAt}: ${checkedDate(source.checked_at, language)}` : ''}</small></div>)}</section>}
                {message.sources.some((source) => source.origin === 'web') && <section><span className="source-group-title">{t.sourcesWeb}</span>{message.sources.filter((source) => source.origin === 'web').map((source) => <div className="chat-source" key={source.id}><a href={source.url} target="_blank" rel="noreferrer">[{source.id.replace('web-', 'W')}] {source.title}<span aria-hidden="true">↗</span></a><small>{source.publisher} · {t.webCheckedToday}: {source.checked_at ? checkedDate(source.checked_at, language) : ''}</small></div>)}</section>}
              </div>}
              {message.webUnavailable && <p className="web-unavailable" role="status">{t.webUnavailable}</p>}
            </>}</div>)}
            {sending && <div className="message message-assistant"><div className="message-bubble typing" aria-label={t.sending}><i /><i /><i /></div></div>}
            {chatError && <div className="chat-error" role="alert">{t.chatError}</div>}
            <div ref={lastMessageRef} />
          </div>
          <form className="chat-form" onSubmit={sendQuestion}><label htmlFor="question">{t.chatLabel}</label><textarea id="question" ref={questionRef} rows={2} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t.chatPlaceholder} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
            <div className="chat-form-bottom"><span>{question.length}/1000</span><button className="button button-primary send-button" type="submit" disabled={sending || !question.trim()} aria-busy={sending}>{sending ? t.sending : t.send}<span aria-hidden="true">↗</span></button></div>
          </form>
        </div>
      </section>
    </main>
    <footer className="site-footer"><a className="brand" href="#top"><span className="brand-mark" aria-hidden="true">т</span><span>Тарих <i>/</i> Tarih</span></a><span>{t.footer}</span><a href="#top" className="back-top">↑ <span>{language === 'kk' ? 'Жоғары' : 'Наверх'}</span></a></footer>

    <dialog className="event-dialog" ref={dialogRef} aria-labelledby="dialog-title" onClose={() => setSelected(null)} onKeyDown={handleDialogKey} onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current?.close() }}>
      {selected && <div className="dialog-content"><div className="dialog-top"><span className="event-date">{eventDate(selected, language)}</span><button className="dialog-close" aria-label={t.detailClose} onClick={() => dialogRef.current?.close()}>×</button></div><h2 id="dialog-title">{selected.title}</h2><p className="dialog-summary">{selected.summary}</p><div className="dialog-rule" /><p className="dialog-body">{selected.body}</p>
        {selected.translation_fallback && <p className="fallback-note">{language === 'kk' ? 'Қазақша нұсқа әзірге қолжетімсіз. Орысша мәтін көрсетілді.' : 'Русская версия пока недоступна. Показан текст на казахском.'}</p>}
        <section className="source-list"><h3>{t.sources}</h3>{selected.sources.length ? selected.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="source-card"><span className="source-kind">{source.language.toUpperCase()} · {source.publisher}</span><strong>{source.title}</strong><span>{source.reliability_note}</span><span className="source-open">{t.more} ↗</span></a>) : <p>{t.sourcesNone}</p>}</section>
      </div>}
    </dialog>
  </div>
}

export default App
