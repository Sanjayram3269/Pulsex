import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowUpRight, CircleAlert, Radio } from 'lucide-react'
import { message } from '../services/api'

export function Brand() {
  return <Link to="/" className="brand" aria-label="PULSEX home"><span className="brand-icon"><Activity size={20}/></span>PULSE<span>X</span></Link>
}
export function Heading({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <header className="page-head"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <p className="muted lead">{children}</p>}</div>{action}</header>
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="notice error" role="alert"><CircleAlert size={19}/><span>{message(error)}</span>{retry && <button className="btn secondary compact" onClick={retry}>Retry</button>}</div>
}
export function Loading() {
  return <div role="status" aria-label="Loading" className="loading"><div/><div/><div/></div>
}
export function Badge({ state }: { state: string }) {
  return <span className={'badge '+state}><i/>{state.replaceAll('_',' ')}</span>
}
export function Empty({ title, description, to, action }: { title: string; description: string; to?: string; action?: string }) {
  return <div className="panel empty"><span className="feature-icon"><Radio size={24}/></span><h2>{title}</h2><p className="muted">{description}</p>{to && <Link className="btn primary" to={to}>{action}<ArrowUpRight size={16}/></Link>}</div>
}
