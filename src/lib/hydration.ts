export const drinkTypes = [
  { id: 'water', label: 'Agua', factor: 1, icon: '💧' },
  { id: 'sparkling', label: 'Agua con gas', factor: 1, icon: '🫧' },
  { id: 'tea', label: 'Té', factor: 0.95, icon: '🍵' },
  { id: 'coffee', label: 'Café', factor: 0.9, icon: '☕' },
  { id: 'milk', label: 'Leche', factor: 0.9, icon: '🥛' },
  { id: 'juice', label: 'Jugo', factor: 0.9, icon: '🍊' },
  { id: 'sports', label: 'Deportiva', factor: 1, icon: '⚡' },
  { id: 'other', label: 'Otra', factor: 1, icon: '🥤' },
] as const

export type DrinkType = (typeof drinkTypes)[number]['id']

export type DrinkEntry = {
  id: string
  user_id?: string
  drink_type: DrinkType
  volume_ml: number
  hydration_factor: number
  hydration_estimate_ml: number
  notes: string | null
  consumed_at: string
  created_at?: string
}

export type Profile = {
  display_name: string
  daily_goal_ml: number
  preferred_unit: 'ml' | 'oz'
  timezone: string
  theme: 'light' | 'dark'
}

export type ReminderSettings = {
  enabled: boolean
  start_time: string
  end_time: string
  interval_minutes: number
  weekdays: number[]
  suggested_volume_ml: number
  snoozed_until: number | null
  timezone: string
}

export const defaultProfile: Profile = {
  display_name: '',
  daily_goal_ml: 2000,
  preferred_unit: 'ml',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  theme: 'light',
}

export const defaultReminders: ReminderSettings = {
  enabled: false,
  start_time: '09:00',
  end_time: '20:00',
  interval_minutes: 120,
  weekdays: [1, 2, 3, 4, 5, 6, 0],
  suggested_volume_ml: 250,
  snoozed_until: null,
  timezone: defaultProfile.timezone,
}

export function dateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function entriesForDate(entries: DrinkEntry[], date: string, timezone: string) {
  return entries
    .filter((entry) => dateKey(new Date(entry.consumed_at), timezone) === date)
    .sort((a, b) => b.consumed_at.localeCompare(a.consumed_at))
}

export function hydrationTotal(entries: DrinkEntry[]) {
  return entries.reduce((total, entry) => total + entry.hydration_estimate_ml, 0)
}

export function formatVolume(ml: number, unit: Profile['preferred_unit']) {
  if (unit === 'oz') return `${(ml / 29.5735).toFixed(1)} oz`
  return `${Math.round(ml).toLocaleString('es')} ml`
}

export function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('es', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value))
}
