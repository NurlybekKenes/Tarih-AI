import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { copyFor, type Language } from './i18n'

type Source = { id: string; title: string; author: string; publisher: string; url: string; language: string; reliability_note: string }
type HistoricalEvent = {
  slug: string; date_from: string; date_to: string; date_precision: string; category: string;
  title: string; summary: string; body: string; translation_fallback?: boolean; sources: Source[]
}
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; sources?: Source[]; mode?: string; insufficient?: boolean }

const API = ''

function eventDate(event: HistoricalEvent, language: Language) {
  if (event.slug === 'tanbaly-petroglyphs') return language === 'kk' ? 'Қола дәуірінен · шамамен' : 'С бронзового века · примерно'
  if (event.slug === 'kazakhstan-independence') return language === 'kk' ? '1991 жылғы 16 желтоқсан' : '16 декабря 1991 г.'
  if (event.date_precision === 'year-range') {
    const start = event.date_from.slice(0, 4)
    const end = event.date_to.slice(0, 4)
    return language === 'kk' ? `${start}–${end} жылдары` : `${start}–${end} гг.`
  }
  const date = new Date(`${event.date_from}T00:00:00Z`)
  return new Intl.DateTimeFormat(language === 'kk' ? 'kk-KZ' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('tarih-language') === 'kk' ? 'kk' : 'ru'))
  const [events, setEvents] = useState<HistoricalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<HistoricalEvent | null>(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('tarih-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState(false)
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
      const response = await fetch(`${API}/api/events?${params}`)
      if (!response.ok) throw new Error('Could not load events')
      const data: { items: HistoricalEvent[] } = await response.json()
      setEvents(data.items)
    } catch {
      setLoadError(true)
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
      const response = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, language }) })
      if (!response.ok) throw new Error('Chat request failed')
      const data: { answer: string; sources: Source[]; mode: string; insufficient_data: boolean } = await response.json()
      setMessages((current) => [...current, { id: Date.now() + 1, role: 'assistant', text: data.answer, sources: data.sources, mode: data.mode, insufficient: data.insufficient_data }])
    } catch { setChatError(true) } finally { setSending(false) }
  }

  function usePrompt(text: string) { setQuestion(text); questionRef.current?.focus() }
  function handleDialogKey(event: KeyboardEvent<HTMLDialogElement>) { if (event.key === 'Escape') setSelected(null) }

  const featured = events.find((event) => event.slug === 'kazakhstan-independence') ?? events[0]

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Тарих / Tarih — на главную"><span className="brand-mark" aria-hidden="true">т</span><span>Тарих <i>/</i> Tarih</span></a>
      <nav className="main-nav" aria-label={language === 'kk' ? 'Негізгі навигация' : 'Основная навигация'}>
        <a href="#timeline">{t.navTimeline}</a><a href="#guide">{t.navGuide}</a>
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
        <div className="results-line"><span>{t.results}</span>{!loading && <span>{events.length.toString().padStart(2, '0')}</span>}</div>
        {loading && <div className="event-grid" aria-busy="true" aria-label={t.loading}><div className="skeleton-card" /><div className="skeleton-card" /></div>}
        {loadError && !loading && <div className="state-panel" role="alert"><p>{t.loadError}</p><button className="button button-outline" onClick={() => void loadEvents()}>{t.retry}</button></div>}
        {!loading && !loadError && events.length === 0 && <div className="state-panel"><p>{t.noResults}</p><span>{t.noResultsHelp}</span><button className="text-link" onClick={() => setQuery('')}>{t.retry}</button></div>}
        {!loading && !loadError && events.length > 0 && <div className="event-grid">{events.map((event, index) => <article className="event-card" key={event.slug}>
          <div className="event-meta"><span className="event-index">{String(index + 1).padStart(2, '0')}</span><span className="event-date">{eventDate(event, language)}</span><span className="category-pill">{t.categories[event.category as keyof typeof t.categories] ?? event.category}</span></div>
          <h3>{event.title}</h3><p className="event-summary">{event.summary}</p>
          <div className="event-card-footer"><span>{event.sources?.length ?? 0} {t.source}</span><button className="text-link" onClick={() => setSelected(event)}>{t.more}<span aria-hidden="true">↗</span></button></div>
        </article>)}</div>}
      </section>

      <section className="guide-section" id="guide" aria-labelledby="guide-title">
        <div className="guide-intro"><p className="eyebrow"><span className="eyebrow-rule" />{t.guideEyebrow}</p><h2 id="guide-title">{t.guideTitle}</h2><p>{t.guideBody}</p>
          <div className="prompt-list" aria-label={language === 'kk' ? 'Сұрақ мысалдары' : 'Примеры вопросов'}>{t.prompts.map((prompt) => <button key={prompt} className="prompt-chip" onClick={() => usePrompt(prompt)}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>
        </div>
        <div className="chat-panel"><div className="chat-head"><div className="guide-avatar" aria-hidden="true">т</div><div><strong>Тарих AI</strong><span>{t.sourceNotice}</span></div><span className="online-mark" aria-label={language === 'kk' ? 'Қолжетімді' : 'Доступен'} /></div>
          <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
            {messages.length === 0 && <div className="chat-empty"><span className="chat-star" aria-hidden="true">✳</span><p>{language === 'kk' ? 'Оқиғалар, дәуірлер немесе дереккөздер туралы сұраңыз.' : 'Спросите о событиях, эпохах или источниках.'}</p></div>}
            {messages.map((message) => <div className={`message message-${message.role}`} key={message.id}><div className="message-bubble">{message.text}</div>{message.role === 'assistant' && <>
              {message.insufficient && <p className="insufficient-note">{t.insufficient}</p>}
              <span className="mode-tag">{message.mode === 'demo' ? t.modeDemo : message.mode === 'fallback' ? t.modeFallback : t.modeAi}</span>
              {!!message.sources?.length && <div className="message-sources"><span>{t.sources}</span>{message.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.publisher}<span aria-hidden="true">↗</span></a>)}</div>}
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
