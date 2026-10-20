import { zodResolver } from '@hookform/resolvers/zod'
import {
  Activity, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Droplets,
  GlassWater, History, LogOut, Moon, MoreHorizontal, Plus, Settings2, Sun, Target,
  TrendingUp, UserRound, X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { FormEvent } from 'react'
import { z } from 'zod'
import {
  dateKey, defaultProfile, defaultReminders, drinkTypes, entriesForDate, formatTime,
  formatVolume, hydrationTotal, type DrinkEntry, type DrinkType, type Profile,
  type ReminderSettings,
} from './lib/hydration'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type View = 'dashboard' | 'history' | 'statistics' | 'reminders' | 'settings'
const entrySchema = z.object({
  drink_type: z.enum(['water', 'sparkling', 'tea', 'coffee', 'milk', 'juice', 'sports', 'other']),
  volume_ml: z.coerce.number().int().min(1, 'Ingresa una cantidad mayor a 0 ml.').max(5000, 'El máximo por registro es 5,000 ml.'),
  hydration_factor: z.coerce.number().min(0.1, 'El factor mínimo es 0.1.').max(1.2, 'El factor máximo es 1.2.'),
  notes: z.string().max(180, 'La nota debe tener 180 caracteres o menos.'),
  consumed_at: z.string().min(1, 'Selecciona la fecha y hora.'),
})
type EntryForm = z.infer<typeof entrySchema>

const pageTitles: Record<View, string> = {
  dashboard: 'Resumen',
  history: 'Historial',
  statistics: 'Estadísticas',
  reminders: 'Recordatorios',
  settings: 'Configuración',
}

const navigation: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'dashboard', label: 'Resumen', icon: Activity },
  { id: 'history', label: 'Historial', icon: CalendarDays },
  { id: 'statistics', label: 'Estadísticas', icon: TrendingUp },
  { id: 'reminders', label: 'Recordatorios', icon: Bell },
]

const storage = {
  read<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem(key)
      return value ? (JSON.parse(value) as T) : fallback
    } catch {
      return fallback
    }
  },
  write(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      console.warn('No se pudo guardar la preferencia local.')
    }
  },
}

function localDateTimeValue(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function entryFromForm(values: EntryForm, id: string = crypto.randomUUID()): DrinkEntry {
  return {
    id,
    drink_type: values.drink_type,
    volume_ml: values.volume_ml,
    hydration_factor: values.hydration_factor,
    hydration_estimate_ml: Math.round(values.volume_ml * values.hydration_factor),
    notes: values.notes.trim() || null,
    consumed_at: new Date(values.consumed_at).toISOString(),
  }
}

function drinkLabel(type: DrinkType) {
  return drinkTypes.find((drink) => drink.id === type)?.label ?? 'Bebida'
}

function App() {
  const [view, setView] = useState<View>('dashboard')
  const [entries, setEntries] = useState<DrinkEntry[]>(() => storage.read('watermind.entries', []))
  const [profile, setProfile] = useState<Profile>(() => storage.read('watermind.profile', defaultProfile))
  const [reminders, setReminders] = useState<ReminderSettings>(() => storage.read('watermind.reminders', defaultReminders))
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string } | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [initializing, setInitializing] = useState(Boolean(isSupabaseConfigured))
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<DrinkEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date(), profile.timezone))
  const [rangeDays, setRangeDays] = useState<7 | 30>(7)

  const [currentTime, setCurrentTime] = useState(() => new Date())
  const today = dateKey(currentTime, profile.timezone)
  const todayEntries = useMemo(() => entriesForDate(entries, today, profile.timezone), [entries, today, profile.timezone])
  const consumed = hydrationTotal(todayEntries)
  const percentage = profile.daily_goal_ml > 0 ? Math.round((consumed / profile.daily_goal_ml) * 100) : 0
  const remaining = Math.max(0, profile.daily_goal_ml - consumed)

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || sessionUser) return
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ? { id: session.user.id, email: session.user.email } : null)
      if (_event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (!session) setInitializing(false)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setNotice(`No se pudo restaurar la sesión: ${error.message}`)
      setSessionUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null)
      setInitializing(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [sessionUser])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || sessionUser) return
    storage.write('watermind.entries', entries)
    storage.write('watermind.profile', profile)
    storage.write('watermind.reminders', reminders)
  }, [entries, profile, reminders, sessionUser])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !sessionUser) return
    let cancelled = false
    async function loadAccount() {
      setInitializing(true)
      const [profileResult, entryResult, reminderResult] = await Promise.all([
        supabase!.from('user_watermind').select('display_name,daily_goal_ml,preferred_unit,timezone,theme').eq('id', sessionUser!.id).single(),
        supabase!.from('drink_entries_watermind').select('*').eq('user_id', sessionUser!.id).order('consumed_at', { ascending: false }).limit(1000),
        supabase!.from('reminder_settings_watermind').select('*').eq('user_id', sessionUser!.id).maybeSingle(),
      ])
      if (cancelled) return
      const failed = [profileResult.error, entryResult.error, reminderResult.error].find(Boolean)
      if (failed) setNotice(`No se pudieron cargar todos tus datos: ${failed.message}`)
      if (profileResult.data) {
        const row = profileResult.data
        setProfile({
          display_name: row.display_name ?? '',
          daily_goal_ml: row.daily_goal_ml,
          preferred_unit: row.preferred_unit,
          timezone: row.timezone,
          theme: row.theme,
        })
      }
      if (entryResult.data) setEntries(entryResult.data as DrinkEntry[])
      if (reminderResult.data) {
        const row = reminderResult.data
        setReminders({
          ...defaultReminders,
          enabled: row.enabled,
          start_time: row.start_time.slice(0, 5),
          end_time: row.end_time.slice(0, 5),
          interval_minutes: row.interval_minutes,
          weekdays: row.weekdays,
          timezone: row.timezone,
          snoozed_until: row.snoozed_until ? new Date(row.snoozed_until).getTime() : null,
        })
      }
      setInitializing(false)
    }
    void loadAccount()
    return () => { cancelled = true }
  }, [sessionUser])

  useEffect(() => {
    document.documentElement.dataset.theme = profile.theme
  }, [profile.theme])

  useEffect(() => {
    if (!reminders.enabled) return
    const timer = window.setInterval(() => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return
      if (Date.now() < (reminders.snoozed_until ?? 0)) return
      const now = new Date()
      const localKey = dateKey(now, reminders.timezone ?? profile.timezone)
      const weekday = new Date(`${localKey}T12:00:00`).getDay()
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: reminders.timezone ?? profile.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(now)
      const [hour, minute] = time.split(':').map(Number)
      const [startHour, startMinute] = reminders.start_time.split(':').map(Number)
      const [endHour, endMinute] = reminders.end_time.split(':').map(Number)
      const minutes = hour * 60 + minute
      const start = startHour * 60 + startMinute
      const end = endHour * 60 + endMinute
      if (!reminders.weekdays.includes(weekday) || minutes < start || minutes > end) return
      const elapsedMinutes = minutes - start
      if (elapsedMinutes < 0 || elapsedMinutes % reminders.interval_minutes !== 0) return
      const key = `watermind.reminder.last.${localKey}`
      const last = Number(localStorage.getItem(key) ?? 0)
      if (Date.now() - last < reminders.interval_minutes * 60_000) return
      new Notification('Un momento para hidratarte', {
        body: `¿Te gustaría registrar ${reminders.suggested_volume_ml} ml?`,
        icon: '/water-drop.svg',
      })
      localStorage.setItem(key, String(Date.now()))
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [reminders, profile.timezone])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function saveEntry(values: EntryForm) {
    if (saving) return
    setSaving(true)
    const entry = entryFromForm(values, editingEntry?.id)
    if (isSupabaseConfigured && supabase && sessionUser) {
      const payload = { ...entry, user_id: sessionUser.id }
      const result = editingEntry
        ? await supabase.from('drink_entries_watermind').update(payload).eq('id', editingEntry.id).eq('user_id', sessionUser.id)
        : await supabase.from('drink_entries_watermind').insert(payload)
      if (result.error) {
        setNotice(`No se pudo guardar la bebida: ${result.error.message}`)
        setSaving(false)
        return
      }
    }
    setEntries((current) => editingEntry
      ? current.map((item) => item.id === editingEntry.id ? entry : item)
      : [entry, ...current])
    setModalOpen(false)
    setEditingEntry(null)
    setSaving(false)
    setNotice(editingEntry ? 'Registro actualizado.' : 'Bebida registrada.')
  }

  async function deleteEntry(entry: DrinkEntry) {
    if (!window.confirm(`¿Eliminar el registro de ${drinkLabel(entry.drink_type).toLowerCase()} de ${formatVolume(entry.volume_ml, 'ml')}?`)) return
    if (isSupabaseConfigured && supabase && sessionUser) {
      const { error } = await supabase.from('drink_entries_watermind').delete().eq('id', entry.id).eq('user_id', sessionUser.id)
      if (error) {
        setNotice(`No se pudo eliminar el registro: ${error.message}`)
        return
      }
    }
    setEntries((current) => current.filter((item) => item.id !== entry.id))
    setNotice('Registro eliminado.')
  }

  async function updateProfile(next: Profile) {
    if (isSupabaseConfigured && supabase && sessionUser) {
      const { error } = await supabase.from('user_watermind').update({
        display_name: next.display_name,
        daily_goal_ml: next.daily_goal_ml,
        preferred_unit: next.preferred_unit,
        timezone: next.timezone,
        theme: next.theme,
      }).eq('id', sessionUser.id)
      if (error) {
        setNotice(`No se pudo guardar la configuración: ${error.message}`)
        return
      }
    }
    setProfile(next)
    setNotice('Configuración guardada.')
  }

  async function updateReminders(next: ReminderSettings) {
    const value = { ...next, timezone: profile.timezone }
    if (value.start_time >= value.end_time) {
      setNotice('La hora de fin debe ser posterior a la hora de inicio.')
      return
    }
    if (!value.weekdays.length) {
      setNotice('Selecciona al menos un día para los recordatorios.')
      return
    }
    if (value.suggested_volume_ml < 50 || value.suggested_volume_ml > 2000) {
      setNotice('El volumen sugerido debe estar entre 50 y 2,000 ml.')
      return
    }
    if (isSupabaseConfigured && supabase && sessionUser) {
      const { error } = await supabase.from('reminder_settings_watermind').upsert({
        user_id: sessionUser.id,
        enabled: value.enabled,
        start_time: value.start_time,
        end_time: value.end_time,
        interval_minutes: value.interval_minutes,
        weekdays: value.weekdays,
        timezone: profile.timezone,
        snoozed_until: value.snoozed_until ? new Date(value.snoozed_until).toISOString() : null,
      })
      if (error) {
        setNotice(`No se pudieron guardar los recordatorios: ${error.message}`)
        return
      }
    }
    setReminders(value)
    setNotice('Preferencias de recordatorios guardadas.')
  }

  async function quickAdd(volume: number) {
    const value: EntryForm = {
      drink_type: 'water',
      volume_ml: volume,
      hydration_factor: 1,
      notes: '',
      consumed_at: localDateTimeValue(),
    }
    await saveEntry(value)
  }

  async function signOut() {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) setNotice(`No se pudo cerrar la sesión: ${error.message}`)
    }
    setSessionUser(null)
    setEntries([])
    setProfile(defaultProfile)
  }

  async function deleteAccount() {
    if (!window.confirm('Esta acción elimina permanentemente tu cuenta, preferencias y registros. ¿Quieres continuar?')) return
    if (!isSupabaseConfigured || !supabase || !sessionUser) {
      setEntries([])
      setProfile(defaultProfile)
      setReminders(defaultReminders)
      localStorage.removeItem('watermind.entries')
      localStorage.removeItem('watermind.profile')
      localStorage.removeItem('watermind.reminders')
      setNotice('Se eliminaron los datos guardados en este navegador.')
      return
    }
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' })
    if (error) {
      setNotice(`No se pudo eliminar la cuenta. Verifica que la función delete-account esté desplegada: ${error.message}`)
      return
    }
    await supabase.auth.signOut()
    setSessionUser(null)
    setEntries([])
    setProfile(defaultProfile)
    setReminders(defaultReminders)
    setNotice('La cuenta y sus datos se eliminaron.')
  }

  function exportCsv() {
    const rows = [
      ['fecha_hora', 'tipo', 'volumen_ml', 'factor_hidratacion', 'estimacion_hidratacion_ml', 'nota'],
      ...entries.map((entry) => [
        entry.consumed_at,
        drinkLabel(entry.drink_type),
        String(entry.volume_ml),
        String(entry.hydration_factor),
        String(entry.hydration_estimate_ml),
        entry.notes ?? '',
      ]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `watermind-historial-${today}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (initializing) return <div className="loading-screen"><Droplets className="spin" /><span>Cargando tus datos…</span></div>
  if (passwordRecovery && supabase) return <PasswordRecoveryScreen onComplete={() => setPasswordRecovery(false)} onNotice={setNotice} notice={notice} />
  if (isSupabaseConfigured && !sessionUser) return <AuthScreen onAuthenticated={(user) => setSessionUser(user)} onNotice={setNotice} notice={notice} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView('dashboard') }}>
          <span className="brand-mark"><Droplets size={23} fill="currentColor" /></span>
          <span>watermind<span className="brand-dot">.</span></span>
        </a>
        <div className="nav-label">MENÚ</div>
        <nav aria-label="Navegación principal">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
              {id === 'reminders' && reminders.enabled && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tip-card">
            <span className="tip-icon"><CircleHelp size={18} /></span>
            <strong>Pequeños sorbos, grandes hábitos.</strong>
            <span>Encuentra tu ritmo, un vaso a la vez.</span>
          </div>
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <Settings2 size={19} strokeWidth={1.8} /><span>Configuración</span>
          </button>
          {isSupabaseConfigured && <button className="nav-item logout" onClick={() => void signOut()}><LogOut size={19} /><span>Cerrar sesión</span></button>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">TU ESPACIO DE BIENESTAR</span>
            <h1>{pageTitles[view]}</h1>
          </div>
          <div className="topbar-right">
            <span className="today-label"><CalendarDays size={16} />{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeZone: profile.timezone }).format(new Date())}</span>
            <button className="icon-button theme-toggle" aria-label={profile.theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'} onClick={() => void updateProfile({ ...profile, theme: profile.theme === 'light' ? 'dark' : 'light' })}>
              {profile.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="profile-chip" onClick={() => setView('settings')} aria-label="Abrir configuración de perfil">
              <span className="avatar">{(profile.display_name || sessionUser?.email || 'T').slice(0, 1).toUpperCase()}</span>
              <span>{profile.display_name || sessionUser?.email?.split('@')[0] || 'Tu perfil'}</span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        {!isSupabaseConfigured && (
          <div className="local-banner"><span className="local-indicator" /> Modo local · tus datos se guardan solo en este navegador <span className="banner-separator">·</span> <button onClick={() => setView('settings')}>Configurar sincronización</button></div>
        )}

        {view === 'dashboard' && (
          <Dashboard
            entries={todayEntries} total={consumed} goal={profile.daily_goal_ml} percentage={percentage}
            remaining={remaining} unit={profile.preferred_unit} timezone={profile.timezone}
            onQuickAdd={quickAdd} onOpenEntry={() => { setEditingEntry(null); setModalOpen(true) }}
            onEdit={(entry) => { setEditingEntry(entry); setModalOpen(true) }}
            onDelete={(entry) => void deleteEntry(entry)}
            loading={saving}
          />
        )}
        {view === 'history' && (
          <HistoryPage entries={entries} selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            timezone={profile.timezone} goal={profile.daily_goal_ml} unit={profile.preferred_unit}
            onEdit={(entry) => { setEditingEntry(entry); setModalOpen(true) }}
            onDelete={(entry) => void deleteEntry(entry)} />
        )}
        {view === 'statistics' && <StatisticsPage entries={entries} profile={profile} rangeDays={rangeDays} setRangeDays={setRangeDays} />}
        {view === 'reminders' && <RemindersPage settings={reminders} onSave={(value) => void updateReminders(value)} />}
        {view === 'settings' && (
          <SettingsPage profile={profile} userEmail={sessionUser?.email} onSave={(value) => void updateProfile(value)}
            onExport={exportCsv} onDelete={() => void deleteAccount()} />
        )}
        <footer className="app-footer"><span>Hecho para cuidar de ti, a tu ritmo.</span><span>Tu bienestar no se mide en perfección.</span></footer>
      </main>

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)} aria-label={label}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>

      {modalOpen && <EntryModal entry={editingEntry} onClose={() => { setModalOpen(false); setEditingEntry(null) }} onSubmit={saveEntry} saving={saving} />}
      {notice && <div className="toast" role="status"><Check size={17} />{notice}<button aria-label="Cerrar mensaje" onClick={() => setNotice('')}><X size={16} /></button></div>}
    </div>
  )
}

function AuthScreen({ onAuthenticated, onNotice, notice }: {
  onAuthenticated: (user: { id: string; email?: string }) => void
  onNotice: (value: string) => void
  notice: string
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'recovery'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [working, setWorking] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setWorking(true)
    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } })
        if (error) onNotice(error.message)
        else if (data.session?.user) {
          onNotice('')
          onAuthenticated({ id: data.session.user.id, email: data.session.user.email })
        } else {
          onNotice('La cuenta se creó, pero no se inició la sesión. Intenta iniciar sesión con los datos de esa cuenta.')
        }
      } else if (mode === 'recovery') {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        if (error) onNotice(error.message)
        else onNotice('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) onNotice(error.message)
      }
    } catch (error) {
      onNotice(`No se pudo completar la solicitud: ${error instanceof Error ? error.message : 'error inesperado'}`)
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <a className="brand auth-brand" href="#"><span className="brand-mark"><Droplets size={23} fill="currentColor" /></span><span>watermind<span className="brand-dot">.</span></span></a>
        <span className="eyebrow">TU ESPACIO DE BIENESTAR</span>
        <h1>{mode === 'login' ? 'Qué gusto verte' : mode === 'register' ? 'Comienza a cuidarte' : 'Recupera tu acceso'}</h1>
        <p className="muted">{mode === 'recovery' ? 'Te enviaremos un enlace de recuperación a tu correo.' : 'Registra tu hidratación con calma, un día a la vez.'}</p>
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          {mode === 'register' && <label>Nombre<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Cómo te llamas" /></label>}
          <label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" /></label>
          {mode !== 'recovery' && <label>Contraseña<input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Al menos 8 caracteres" /></label>}
          <button className="primary-button full-width" disabled={working}>{working ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : mode === 'register' ? 'Crear cuenta' : 'Enviar enlace'}</button>
        </form>
        {notice && <p className="form-notice" role="status">{notice}</p>}
        <div className="auth-links">
          {mode === 'login' && <button onClick={() => { setMode('recovery'); onNotice('') }}>¿Olvidaste tu contraseña?</button>}
          <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); onNotice('') }}>
            {mode === 'register' ? 'Ya tengo una cuenta' : 'Crear cuenta'}
          </button>
          {mode === 'recovery' && <button onClick={() => { setMode('login'); onNotice('') }}>Volver a iniciar sesión</button>}
        </div>
        <p className="auth-privacy">Tus registros son privados y solo tú puedes consultarlos.</p>
      </div>
    </div>
  )
}

function PasswordRecoveryScreen({ onComplete, onNotice, notice }: {
  onComplete: () => void; onNotice: (value: string) => void; notice: string
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [working, setWorking] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    if (password.length < 8) {
      onNotice('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmation) {
      onNotice('Las contraseñas no coinciden.')
      return
    }
    setWorking(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) onNotice(`No se pudo actualizar la contraseña: ${error.message}`)
    else {
      onNotice('')
      onComplete()
    }
    setWorking(false)
  }
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <a className="brand auth-brand" href="#"><span className="brand-mark"><Droplets size={23} fill="currentColor" /></span><span>watermind<span className="brand-dot">.</span></span></a>
        <span className="eyebrow">RECUPERACIÓN DE CUENTA</span>
        <h1>Elige una contraseña nueva</h1>
        <p className="muted">Usa al menos 8 caracteres para proteger tu cuenta.</p>
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirma la contraseña<input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <button className="primary-button full-width" disabled={working}>{working ? 'Guardando…' : 'Actualizar contraseña'}</button>
        </form>
        {notice && <p className="form-notice" role="status">{notice}</p>}
      </div>
    </div>
  )
}

function Dashboard(props: {
  entries: DrinkEntry[]; total: number; goal: number; percentage: number; remaining: number;
  unit: Profile['preferred_unit']; timezone: string; onQuickAdd: (volume: number) => void;
  onOpenEntry: () => void; onEdit: (entry: DrinkEntry) => void; onDelete: (entry: DrinkEntry) => void;
  loading: boolean
}) {
  const { entries, total, goal, percentage, remaining, unit, timezone, onQuickAdd, onOpenEntry, onEdit, onDelete, loading } = props
  const welcome = total === 0 ? 'Todo gran hábito empieza con un primer sorbo.' : percentage >= 100 ? '¡Objetivo cumplido! Qué buen cuidado.' : percentage >= 50 ? 'Vas muy bien, sigue a tu ritmo.' : 'Cada sorbo cuenta. Tú marcas el ritmo.'
  const circumference = 2 * Math.PI * 76
  return (
    <>
      <section className="welcome-row">
        <div><h2>Hola, qué bueno verte <span className="wave">✦</span></h2><p>{welcome}</p></div>
        <button className="primary-button add-top" onClick={onOpenEntry}><Plus size={18} /> Registrar bebida</button>
      </section>
      <div className="dashboard-grid">
        <section className="card progress-card">
          <div className="card-heading"><div><span className="section-kicker">TU PROGRESO DE HOY</span><h3>Un paso a la vez</h3></div><span className="soft-icon"><Droplets size={19} /></span></div>
          <div className="progress-main">
            <div className="progress-ring" role="img" aria-label={`${percentage}% del objetivo diario completado`}>
              <svg viewBox="0 0 180 180" aria-hidden="true">
                <circle className="ring-track" cx="90" cy="90" r="76" />
                <circle className="ring-value" cx="90" cy="90" r="76" strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - Math.min(percentage, 100) / 100)} />
              </svg>
              <div className="ring-label"><span className="ring-amount">{formatVolume(total, unit)}</span><span>de {formatVolume(goal, unit)}</span></div>
            </div>
            <div className="progress-copy">
              <span className="progress-percent">{percentage}<small>%</small></span>
              <span className="muted">del objetivo diario</span>
              <div className="remaining-box"><span className="remaining-icon"><Target size={16} /></span><span><strong>{remaining > 0 ? formatVolume(remaining, unit) : '¡Meta alcanzada!'}</strong><small>{remaining > 0 ? 'para completar tu meta' : 'Puedes seguir registrando'}</small></span></div>
            </div>
          </div>
          <div className="progress-footer"><span><Droplets size={15} /> {entries.length} {entries.length === 1 ? 'bebida registrada' : 'bebidas registradas'}</span><span>{percentage >= 100 ? '¡Excelente trabajo!' : 'Vas a tu propio ritmo'}</span></div>
        </section>

        <section className="card quick-card">
          <div className="card-heading"><div><span className="section-kicker">REGISTRO RÁPIDO</span><h3>¿Tomaste un vaso?</h3></div><span className="soft-icon peach"><GlassWater size={19} /></span></div>
          <p className="card-subtitle">Un toque y listo. Puedes cambiar los detalles luego.</p>
          <div className="quick-options">
            {[150, 250, 350, 500].map((amount) => <button key={amount} disabled={loading} onClick={() => void onQuickAdd(amount)}><span className="mini-glass"><Droplets size={16} /></span><strong>{amount}</strong><small>ml</small></button>)}
          </div>
          <button className="secondary-button custom-button" onClick={onOpenEntry}><Plus size={16} /> Cantidad personalizada</button>
          <div className="water-note"><span>💧</span><span>Beber agua es autocuidado, no una tarea.</span></div>
        </section>

        <section className="card activity-card">
          <div className="card-heading"><div><span className="section-kicker">ACTIVIDAD DE HOY</span><h3>Tus bebidas</h3></div><span className="count-pill">{entries.length}</span></div>
          {entries.length ? <div className="drink-list">{entries.slice(0, 5).map((entry) => <DrinkRow key={entry.id} entry={entry} unit={unit} timezone={timezone} onEdit={onEdit} onDelete={onDelete} />)}</div>
            : <div className="empty-inline"><span className="empty-illustration">🥛</span><strong>Aún no hay registros</strong><span>Cuando tomes algo, puedes anotarlo aquí.</span></div>}
          {entries.length > 5 && <p className="more-records">Y {entries.length - 5} registros más hoy</p>}
        </section>

        <WeekChart entries={entries} goal={goal} timezone={timezone} unit={unit} compact />
      </div>
    </>
  )
}

function DrinkRow({ entry, unit, timezone, onEdit, onDelete }: {
  entry: DrinkEntry; unit: Profile['preferred_unit']; timezone: string;
  onEdit: (entry: DrinkEntry) => void; onDelete: (entry: DrinkEntry) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const drink = drinkTypes.find((item) => item.id === entry.drink_type)
  return (
    <div className="drink-row">
      <span className={`drink-icon drink-${entry.drink_type}`}>{drink?.icon ?? '🥤'}</span>
      <span className="drink-detail"><strong>{drinkLabel(entry.drink_type)}</strong><small>{formatTime(entry.consumed_at, timezone)}{entry.notes ? ` · ${entry.notes}` : ''}</small></span>
      <span className="drink-amount">{formatVolume(entry.volume_ml, unit)}</span>
      <div className="row-actions">
        <button className="icon-button tiny" aria-label={`Opciones de ${drinkLabel(entry.drink_type)}`} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={17} /></button>
        {menuOpen && <div className="row-menu"><button onClick={() => onEdit(entry)}>Editar</button><button className="danger-text" onClick={() => onDelete(entry)}>Eliminar</button></div>}
      </div>
    </div>
  )
}

function WeekChart({ entries, goal, timezone, unit, compact = false, days = 7 }: {
  entries: DrinkEntry[]; goal: number; timezone: string; unit: Profile['preferred_unit']; compact?: boolean; days?: 7 | 30
}) {
  const data = useMemo(() => Array.from({ length: days }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (days - 1 - index))
    const key = dateKey(date, timezone)
    const total = hydrationTotal(entriesForDate(entries, key, timezone))
    return {
      day: new Intl.DateTimeFormat('es', days === 7 ? { weekday: 'short', timeZone: timezone } : { day: 'numeric', timeZone: timezone }).format(date).replace('.', ''),
      total,
      goal,
      label: new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: timezone }).format(date),
    }
  }), [entries, goal, timezone, days])
  return (
    <section className={`card chart-card ${compact ? 'compact-chart' : ''}`}>
      <div className="card-heading"><div><span className="section-kicker">{compact ? 'ÚLTIMOS 7 DÍAS' : 'TU ACTIVIDAD'}</span><h3>{compact ? 'Tu ritmo semanal' : 'Consumo diario'}</h3></div><span className="chart-legend"><i /> Consumo <i className="legend-goal" /> Objetivo</span></div>
      {!entries.length ? <div className="chart-empty"><Activity size={22} /><span>Tus registros aparecerán aquí cuando empieces.</span></div> :
        <div className="chart-wrap"><ResponsiveContainer width="100%" height={compact ? 180 : 260}>
          <AreaChart data={data} margin={{ top: 12, right: 8, left: -15, bottom: 0 }}>
            <defs><linearGradient id={`waterFill-${compact ? 'small' : 'large'}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6fc3ed" stopOpacity={0.24} /><stop offset="95%" stopColor="#6fc3ed" stopOpacity={0.01} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} dy={8} />
            <YAxis hide domain={[0, Math.max(goal * 1.25, ...data.map((item) => item.total), 500)]} />
            <Tooltip formatter={(value) => [formatVolume(Number(value), unit), '']} labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ''} contentStyle={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--card)', color: 'var(--text)' }} />
            <Area type="monotone" dataKey="goal" stroke="#b9c7d2" strokeDasharray="4 4" strokeWidth={1.5} fill="none" activeDot={false} />
            <Area type="monotone" dataKey="total" stroke="#53aee0" strokeWidth={2.5} fill={`url(#waterFill-${compact ? 'small' : 'large'})`} />
          </AreaChart>
        </ResponsiveContainer></div>}
      {!compact && <div className="chart-footnote">El consumo se estima según el tipo de bebida que registraste.</div>}
    </section>
  )
}

function HistoryPage({ entries, selectedDate, setSelectedDate, timezone, goal, unit, onEdit, onDelete }: {
  entries: DrinkEntry[]; selectedDate: string; setSelectedDate: (date: string) => void;
  timezone: string; goal: number; unit: Profile['preferred_unit'];
  onEdit: (entry: DrinkEntry) => void; onDelete: (entry: DrinkEntry) => void
}) {
  const selectedEntries = entriesForDate(entries, selectedDate, timezone)
  const total = hydrationTotal(selectedEntries)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [selectedDate])
  const pageItems = selectedEntries.slice(page * 20, page * 20 + 20)
  return (
    <div className="page-stack">
      <section className="card history-summary">
        <div className="history-date"><span className="section-kicker">ELIGE UN DÍA</span><input aria-label="Seleccionar fecha del historial" type="date" value={selectedDate} max={dateKey(new Date(), timezone)} onChange={(event) => setSelectedDate(event.target.value)} /></div>
        <div className="history-total"><strong>{formatVolume(total, unit)}</strong><span>de {formatVolume(goal, unit)} objetivo</span></div>
        <div className="history-progress"><span style={{ width: `${Math.min(total / goal * 100, 100)}%` }} /></div>
        <div className="history-subline"><span>{selectedEntries.length} {selectedEntries.length === 1 ? 'bebida registrada' : 'bebidas registradas'}</span><span>{Math.round(total / goal * 100)}% del objetivo</span></div>
      </section>
      <section className="card">
        <div className="card-heading"><div><span className="section-kicker">REGISTROS</span><h3>{new Intl.DateTimeFormat('es', { dateStyle: 'full', timeZone: timezone }).format(new Date(`${selectedDate}T12:00:00`))}</h3></div></div>
        {pageItems.length ? <div className="drink-list history-list">{pageItems.map((entry) => <DrinkRow key={entry.id} entry={entry} unit={unit} timezone={timezone} onEdit={onEdit} onDelete={onDelete} />)}</div>
          : <div className="empty-state"><span className="empty-illustration">📖</span><strong>No hay bebidas para este día</strong><span>Prueba otra fecha o registra una nueva bebida.</span></div>}
        {selectedEntries.length > 20 && <div className="pagination"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>{page + 1} / {Math.ceil(selectedEntries.length / 20)}</span><button className="secondary-button" disabled={(page + 1) * 20 >= selectedEntries.length} onClick={() => setPage(page + 1)}>Siguiente</button></div>}
      </section>
    </div>
  )
}

function StatisticsPage({ entries, profile, rangeDays, setRangeDays }: {
  entries: DrinkEntry[]; profile: Profile; rangeDays: 7 | 30; setRangeDays: (range: 7 | 30) => void
}) {
  const data = useMemo(() => Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (rangeDays - 1 - index))
    const key = dateKey(date, profile.timezone)
    const total = hydrationTotal(entriesForDate(entries, key, profile.timezone))
    return { day: new Intl.DateTimeFormat('es', { day: rangeDays === 7 ? 'numeric' : undefined, month: rangeDays === 7 ? 'short' : 'numeric', weekday: rangeDays === 7 ? 'short' : undefined, timeZone: profile.timezone }).format(date), total, goal: profile.daily_goal_ml }
  }), [entries, profile.daily_goal_ml, profile.timezone, rangeDays])
  const totalDays = data.filter((item) => item.total > 0).length
  const achieved = data.filter((item) => item.total >= item.goal && item.total > 0).length
  const avg = totalDays ? data.reduce((sum, item) => sum + item.total, 0) / totalDays : 0
  const best = data.reduce((bestDay, current) => current.total > bestDay.total ? current : bestDay, data[0])
  const goalsHitPercent = totalDays ? Math.round(achieved / totalDays * 100) : 0
  return (
    <div className="page-stack">
      <div className="range-tabs"><button className={rangeDays === 7 ? 'selected' : ''} onClick={() => setRangeDays(7)}>7 días</button><button className={rangeDays === 30 ? 'selected' : ''} onClick={() => setRangeDays(30)}>30 días</button></div>
      <div className="stats-grid">
        <StatCard icon={Droplets} label="Promedio diario" value={formatVolume(avg, profile.preferred_unit)} detail={`en ${totalDays} días con registros`} />
        <StatCard icon={Target} label="Objetivos alcanzados" value={`${goalsHitPercent}%`} detail={`${achieved} de ${totalDays} días registrados`} />
        <StatCard icon={TrendingUp} label="Mejor día" value={formatVolume(best?.total ?? 0, profile.preferred_unit)} detail={best?.total ? 'según tu hidratación estimada' : 'aún sin registros'} />
      </div>
      <WeekChart entries={entries} goal={profile.daily_goal_ml} timezone={profile.timezone} unit={profile.preferred_unit} days={rangeDays} />
      {!entries.length && <p className="empty-hint">Cuando registres bebidas, aquí verás tus tendencias reales. No mostramos datos de ejemplo.</p>}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <section className="card stat-card"><span className="soft-icon"><Icon size={19} /></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></section>
}

function RemindersPage({ settings, onSave }: { settings: ReminderSettings; onSave: (value: ReminderSettings) => void }) {
  const [local, setLocal] = useState(settings)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('Notification' in window ? Notification.permission : 'unsupported')
  useEffect(() => setLocal(settings), [settings])
  async function enableNotifications() {
    if (!('Notification' in window)) {
      setPermission('unsupported')
      return
    }
    const result = await Notification.requestPermission()
    setPermission(result)
  }
  function toggleDay(day: number) {
    const weekdays = local.weekdays.includes(day) ? local.weekdays.filter((item) => item !== day) : [...local.weekdays, day]
    setLocal({ ...local, weekdays })
  }
  const dayNames = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
  return (
    <div className="page-stack narrow-stack">
      <section className="card reminder-intro"><span className="large-soft-icon"><Bell size={22} /></span><div><span className="section-kicker">A TU RITMO</span><h3>Un recordatorio amable</h3><p>Una pequeña pausa para notar cómo te sientes. Puedes cambiar o pausar esto cuando quieras.</p></div><label className="switch"><input type="checkbox" checked={local.enabled} onChange={(event) => setLocal({ ...local, enabled: event.target.checked })} /><span /></label></section>
      <section className="card settings-card">
        <h3>Tu horario</h3>
        <p className="card-subtitle">Los avisos funcionan mientras esta aplicación está abierta en el navegador.</p>
        <div className="field-row"><label>Desde<input type="time" value={local.start_time} onChange={(event) => setLocal({ ...local, start_time: event.target.value })} /></label><label>Hasta<input type="time" value={local.end_time} onChange={(event) => setLocal({ ...local, end_time: event.target.value })} /></label></div>
        <label className="form-field">Frecuencia<select value={local.interval_minutes} onChange={(event) => setLocal({ ...local, interval_minutes: Number(event.target.value) })}><option value={60}>Cada hora</option><option value={90}>Cada 90 minutos</option><option value={120}>Cada 2 horas</option><option value={180}>Cada 3 horas</option></select></label>
        <label className="form-field">Volumen sugerido<input type="number" min="50" max="2000" step="50" value={local.suggested_volume_ml} onChange={(event) => setLocal({ ...local, suggested_volume_ml: Math.max(50, Math.min(2000, Number(event.target.value))) })} /></label>
        <div className="form-field"><span className="field-label">Días de la semana</span><div className="weekday-picker">{dayNames.map((day, index) => <button key={`${day}-${index}`} className={local.weekdays.includes(index) ? 'selected' : ''} onClick={() => toggleDay(index)} aria-label={`Día ${day}`} aria-pressed={local.weekdays.includes(index)}>{day}</button>)}</div></div>
        {permission !== 'granted' && <div className="permission-box"><Bell size={17} /><span>{permission === 'unsupported' ? 'Este navegador no admite notificaciones web.' : permission === 'denied' ? 'Las notificaciones están bloqueadas. Puedes permitirlas en la configuración del navegador.' : 'Permite notificaciones para recibir avisos mientras la app esté abierta.'}</span>{permission === 'default' && <button className="text-button" onClick={() => void enableNotifications()}>Permitir</button>}</div>}
        <div className="settings-actions"><button className="secondary-button" onClick={() => { const next = { ...local, snoozed_until: Date.now() + 60 * 60_000 }; setLocal(next); onSave(next) }}>Silenciar 1 hora</button><button className="primary-button" onClick={() => onSave(local)}>Guardar recordatorios</button></div>
      </section>
      <p className="disclaimer"><CircleHelp size={15} /> Los navegadores pueden suspender tareas en segundo plano. Estos avisos no están garantizados cuando cierras la app o el navegador.</p>
    </div>
  )
}

function SettingsPage({ profile, userEmail, onSave, onExport, onDelete }: {
  profile: Profile; userEmail?: string; onSave: (value: Profile) => void; onExport: () => void;
  onDelete: () => void
}) {
  const [local, setLocal] = useState(profile)
  useEffect(() => setLocal(profile), [profile])
  return (
    <div className="page-stack narrow-stack">
      <section className="card settings-card">
        <div className="settings-heading"><span className="large-soft-icon"><UserRound size={21} /></span><div><span className="section-kicker">TU CUENTA</span><h3>Perfil personal</h3></div></div>
        <label className="form-field">Nombre<input maxLength={80} value={local.display_name} onChange={(event) => setLocal({ ...local, display_name: event.target.value })} placeholder="Tu nombre" /></label>
        <label className="form-field">Correo electrónico<input readOnly value={userEmail ?? 'Modo local — sin cuenta conectada'} /></label>
      </section>
      <section className="card settings-card">
        <div className="settings-heading"><span className="large-soft-icon"><Target size={21} /></span><div><span className="section-kicker">TUS PREFERENCIAS</span><h3>Objetivo y formato</h3></div></div>
        <p className="card-subtitle">Puedes ajustar tu objetivo cuando quieras. Es una preferencia personal, no una recomendación médica.</p>
        <div className="field-row"><label>Objetivo diario<input type="number" min="250" max="10000" step="50" value={local.daily_goal_ml} onChange={(event) => setLocal({ ...local, daily_goal_ml: Math.min(10000, Math.max(250, Number(event.target.value))) })} /></label><label>Unidad<select value={local.preferred_unit} onChange={(event) => setLocal({ ...local, preferred_unit: event.target.value as Profile['preferred_unit'] })}><option value="ml">Mililitros (ml)</option><option value="oz">Onzas (oz)</option></select></label></div>
        <label className="form-field">Zona horaria<select value={local.timezone} onChange={(event) => setLocal({ ...local, timezone: event.target.value })}>{Intl.supportedValuesOf('timeZone').map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></label>
        <label className="form-field">Apariencia<select value={local.theme} onChange={(event) => setLocal({ ...local, theme: event.target.value as Profile['theme'] })}><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
        <div className="settings-actions"><span className="muted tiny-note">El cambio de zona horaria afecta cómo se agrupan tus registros.</span><button className="primary-button" onClick={() => onSave(local)}>Guardar cambios</button></div>
      </section>
      <section className="card settings-card">
        <div className="settings-heading"><span className="large-soft-icon peach"><History size={21} /></span><div><span className="section-kicker">TUS DATOS</span><h3>Exportación y privacidad</h3></div></div>
        <p className="card-subtitle">Descarga una copia de tu historial en formato CSV. El archivo incluye fecha, bebida, volumen y estimación de hidratación.</p>
        <div className="privacy-note"><strong>Qué almacenamos</strong><p>Tu nombre, preferencias, configuración de recordatorios y registros de bebidas. En modo local permanecen en este navegador. Con Supabase se guardan en la base de datos de tu proyecto y están protegidos por políticas de acceso por usuario.</p></div>
        <div className="settings-actions"><button className="secondary-button" onClick={onExport}>Descargar historial CSV</button><button className="danger-button" onClick={onDelete}>{isSupabaseConfigured ? 'Eliminar cuenta y datos' : 'Eliminar datos locales'}</button></div>
      </section>
      {!isSupabaseConfigured && <section className="card setup-card"><span className="large-soft-icon"><Droplets size={21} /></span><div><h3>Conecta tu propio proyecto Supabase</h3><p>Agrega las variables de entorno de tu proyecto y ejecuta la migración para activar cuentas, sincronización en PostgreSQL y copias de seguridad.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code></div></section>}
    </div>
  )
}

function EntryModal({ entry, onClose, onSubmit, saving }: {
  entry: DrinkEntry | null; onClose: () => void; onSubmit: (values: EntryForm) => void; saving: boolean
}) {
  const form = useForm<z.input<typeof entrySchema>, unknown, EntryForm>({
    resolver: zodResolver(entrySchema),
    defaultValues: entry ? {
      drink_type: entry.drink_type, volume_ml: entry.volume_ml, notes: entry.notes ?? '',
      hydration_factor: entry.hydration_factor,
      consumed_at: localDateTimeValue(new Date(entry.consumed_at)),
    } : { drink_type: 'water', volume_ml: 250, hydration_factor: 1, notes: '', consumed_at: localDateTimeValue() },
  })
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="entry-modal-title">
        <div className="modal-heading"><div><span className="section-kicker">TU REGISTRO</span><h2 id="entry-modal-title">{entry ? 'Editar bebida' : 'Registrar bebida'}</h2></div><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button></div>
        <form onSubmit={form.handleSubmit((values) => onSubmit(values))}>
          <label className="form-field">Tipo de bebida<select {...form.register('drink_type', { onChange: (event) => {
            const type = drinkTypes.find((drink) => drink.id === event.target.value)
            if (type) form.setValue('hydration_factor', type.factor)
          } })}>{drinkTypes.map((drink) => <option key={drink.id} value={drink.id}>{drink.icon} {drink.label}</option>)}</select></label>
          <label className="form-field">Cantidad en mililitros<input type="number" min="1" max="5000" step="1" {...form.register('volume_ml')} />{form.formState.errors.volume_ml && <small className="field-error">{form.formState.errors.volume_ml.message}</small>}</label>
          <label className="form-field">Factor de hidratación <span className="optional">(ajustable)</span><input type="number" min="0.1" max="1.2" step="0.05" {...form.register('hydration_factor')} />{form.formState.errors.hydration_factor && <small className="field-error">{form.formState.errors.hydration_factor.message}</small>}</label>
          <label className="form-field">Fecha y hora<input type="datetime-local" {...form.register('consumed_at')} />{form.formState.errors.consumed_at && <small className="field-error">{form.formState.errors.consumed_at.message}</small>}</label>
          <label className="form-field">Nota <span className="optional">(opcional)</span><textarea rows={2} maxLength={180} {...form.register('notes')} placeholder="Algo que quieras recordar…" />{form.formState.errors.notes && <small className="field-error">{form.formState.errors.notes.message}</small>}</label>
          <p className="factor-hint">Factor inicial orientativo por bebida; puedes ajustarlo. La estimación no es una recomendación médica.</p>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : entry ? 'Guardar cambios' : 'Registrar bebida'}</button></div>
        </form>
      </section>
    </div>
  )
}

export default App
