import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Radio } from 'lucide-react'
import { PublicFrame } from '../components/public-frame'
import { ErrorBox, Heading } from '../components/ui'
import { api } from '../services/api'

export function Demo() {
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<unknown>()
  const navigate=useNavigate()
  return <PublicFrame><section className="panel audience-card">
    <span className="feature-icon"><Radio/></span>
    <Heading eyebrow="GUIDED DEMO" title="Try a live workshop poll">Create a demonstration room with a real, live ballot. Anyone with its link can join, and no account is needed.</Heading>
    <ol className="form-stack">
      <li>Join your sample room and pick up to two answers.</li>
      <li>Copy the room URL to a private window or second browser to watch as an independent spectator.</li>
      <li>Submit your vote and watch the second screen update.</li>
    </ol>
    <p className="muted">The demo starts empty and expires after one hour.</p>
    {error !== undefined && <ErrorBox error={error}/>}
    <button className="btn primary align-start" disabled={busy} onClick={async()=>{
      setBusy(true);setError(undefined)
      try {const session=await api<{code:string}>('/public/demo','POST',{});navigate('/room/'+session.code)}
      catch (failure) {setError(failure);setBusy(false)}
    }}>Start demo room <ArrowRight size={17}/></button>
    <Link className="btn quiet align-start" to="/register">Create my own poll</Link>
  </section></PublicFrame>
}
