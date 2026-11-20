import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from './ui'

export function PublicFrame({ children }: { children: ReactNode }) {
  return <div className="public-page"><header className="wrap landing-nav"><Brand/><Link to="/" className="muted public-nav">Live polling</Link></header><main className="audience-wrap" id="main" tabIndex={-1}>{children}</main></div>
}
