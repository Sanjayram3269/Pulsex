import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from './ui'

export function PublicFrame({ children, theme }: { children: ReactNode; theme?: string }) {
  return <div className={'public-page theme-'+(theme ?? 'obsidian')}><header className="wrap landing-nav"><Brand/><Link to="/" className="muted public-nav">Live polling</Link></header><main className="audience-wrap" id="main" tabIndex={-1}>{children}</main></div>
}
