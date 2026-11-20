import { useQuery } from '@tanstack/react-query'
import type { User } from '../types/types'

export const base = '/api/v1'
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export async function api<T>(path: string, method = 'GET', payload?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    method, credentials: 'same-origin',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body?.error?.code ?? 'unknown', body?.error?.message ?? 'The server could not complete your request.')
  }
  return response.status === 204 ? undefined as T : response.json()
}
export function useUser() {
  return useQuery({
    queryKey: ['me'], staleTime: 60_000, retry: false,
    queryFn: () => api<User>('/auth/me').catch(error => {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }),
  })
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
