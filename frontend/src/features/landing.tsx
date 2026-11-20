import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, ArrowDown, ArrowRight, BarChart3, Radio, ScanLine, Waves } from 'lucide-react'
import { Brand } from '../components/ui'

export function Landing() {
  const [code, setCode] = useState('')
  const navigate = useNavigate()
  return <div className="landing">
    <header className="landing-nav wrap"><Brand/><nav aria-label="Main navigation"><a href="#workflow">How it works</a><Link to="/login">Sign in</Link><Link className="btn secondary compact" to="/register">Start polling <ArrowRight size={15}/></Link></nav></header>
    <main id="main" tabIndex={-1}>
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow"><Radio size={15}/> LIVE AUDIENCE POLLING</p>
          <h1>Read the room.<br/><em>In real time.</em></h1>
          <p>Ask a question, share a link, and watch the room respond. Run one quick poll or keep a whole event in sync.</p>
          <div className="actions"><Link className="btn primary" to="/register">Create a poll <ArrowRight size={18}/></Link><a className="btn quiet" href="#workflow">See how it works <ArrowDown size={16}/></a></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><div className="signal-label signal-left"><ScanLine size={17}/> SHARE A LINK</div><div className="signal-label signal-right"><Waves size={17}/> LIVE SIGNAL</div><div className="pulse-disc"><Activity/></div></div>
      </section>
      <section id="workflow" className="workflow wrap"><p className="eyebrow">THE WORKFLOW</p><h2>From question to conversation.</h2><div className="feature-grid">
        <article className="panel"><span className="feature-icon"><ScanLine/></span><h3>Create and share</h3><p>Write a question, set your voting rules, and pass around a link or QR code.</p></article>
        <article className="panel"><span className="feature-icon cyan"><Radio/></span><h3>Vote from any device</h3><p>Participants open the poll on their phone and cast a vote in seconds.</p></article>
        <article className="panel"><span className="feature-icon"><BarChart3/></span><h3>See the room respond</h3><p>Watch totals move live, present them on a big screen, and export your results.</p></article>
      </div></section>
      <section className="wrap join"><div className="panel"><div><h2>Joining a live room?</h2><p className="muted">Enter the code from your host.</p></div>
        <form className="actions" onSubmit={e => { e.preventDefault(); navigate('/room/'+code.trim().toLowerCase()) }}>
          <label className="sr-only" htmlFor="room-code">Room code</label><input id="room-code" placeholder="8-character code" pattern="[0-9a-fA-F]{8}" maxLength={8} required value={code} onChange={e => setCode(e.target.value)}/>
          <button className="btn primary">Join room <ArrowRight size={16}/></button>
        </form></div></section>
    </main>
    <footer className="wrap footer"><Brand/><span>Live polls for classrooms, workshops, and events.</span></footer>
  </div>
}
