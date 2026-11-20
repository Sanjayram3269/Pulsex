import type { Room } from '../types/types'

export interface QuizQuestion { prompt: string; choices: string[]; correct: number; seconds: number; points: number }
export interface QuizConfig { questions: QuizQuestion[]; reveal: 'each' | 'final'; participation: 'named' | 'anonymous'; speedBonus: boolean }
export interface QuizOwner extends Room { config: QuizConfig; control: number; joined: number; responses: number }
export interface QuizPlayer { id: string; alias: string; points: number; correct: number; answered: number }
export interface PublicQuiz {
  theme?: string
  qaEnabled?: boolean; qaVersion?: number
  review?: {prompt: string; choices: string[]; correct?: number}[]
  title: string; version: number; state: Room['state']; active: number; total: number; ends: string | null
  participation: QuizConfig['participation']; joined: number; responses: number; player?: string; answered: boolean
  question?: {prompt: string; choices: string[]; correct?: number}; leaderboard?: QuizPlayer[]
}
