export interface User { id: string; name: string; email: string }
export type PollState = 'draft' | 'scheduled' | 'live' | 'closed' | 'archived'
export type Visibility = 'live' | 'after_close' | 'private'
export interface Poll {
  id: string; slug: string; title: string; description: string; choices: string[]; state: PollState
  visibility: Visibility; guests: boolean; opens: string | null; closes: string | null
  allowResults: boolean; voted: boolean; created: string; revision: number; total?: number
}
export interface Snapshot { version: number; counts: number[] }
export interface PollEvent { version: number; state: PollState; counts?: number[] }
export interface Page<T> { items: T[]; hasMore: boolean }
export interface Room {
  id: string; code: string; title: string; polls: string[]; state: RoomState; active: number
  ends: string | null; version: number
}
export type RoomState = 'waiting' | 'live' | 'paused' | 'ended'
export interface AudienceRoom {
  title: string; state: RoomState; slug?: string; version: number; active: number; total: number
  ends: string | null; present: number
}
export interface Analytics { poll: Poll; snapshot: Snapshot; since: string; series: { at: string; votes: number }[] }
