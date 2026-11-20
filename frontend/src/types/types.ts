export interface User { id: string; name: string; email: string }
export type PollState = 'draft' | 'scheduled' | 'live' | 'closed' | 'archived'
export type Visibility = 'live' | 'after_close' | 'private'
export type QuestionType = 'single_choice' | 'multiple_choice' | 'rating' | 'ranked_choice' | 'word_cloud'
export interface Question { version: 1; type: QuestionType; min?: number; max?: number }
export type Ballot = {choice: number} | {choices: number[]} | {rating: number} | {ranking: number[]} | {text: string}
export interface TermCount { text: string; count: number }
export interface Poll {
  question?: Question | null
  id: string; slug: string; title: string; description: string; choices: string[]; state: PollState
  visibility: Visibility; guests: boolean; opens: string | null; closes: string | null
  allowResults: boolean; voted: boolean; created: string; revision: number; total?: number
}
export interface Snapshot { version: number; counts: number[]; ballots?: number; rankPoints?: number[]; terms?: TermCount[] }
export interface PollEvent extends Partial<Omit<Snapshot,'version'>> { version: number; state: PollState }
export interface Page<T> { items: T[]; hasMore: boolean }
export interface Room {
  theme?: string
  id: string; code: string; title: string; polls: string[]; state: RoomState; active: number
  ends: string | null; version: number
}
export type RoomState = 'waiting' | 'live' | 'paused' | 'ended'
export interface AudienceRoom {
  theme?: string
  qaEnabled?: boolean; qaVersion?: number
  title: string; state: RoomState; slug?: string; version: number; active: number; total: number
  ends: string | null; present: number
}
export interface Analytics { poll: Poll; snapshot: Snapshot; since: string; series: { at: string; votes: number }[] }
