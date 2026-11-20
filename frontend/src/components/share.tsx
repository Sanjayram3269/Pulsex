import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, ExternalLink } from 'lucide-react'

export function Share({ path, label }: { path: string; label: string }) {
  const url = new URL(path, location.origin).href
  const [status, setStatus] = useState('')
  return <section className="panel share"><div className="qr"><QRCodeSVG value={url} size={122} title={label+' QR code'}/></div>
    <div><h2>{label}</h2><p className="muted">Share the link or let participants scan the QR code.</p>
      <input aria-label="Share link" readOnly value={url} onFocus={e => e.currentTarget.select()}/>
      <div className="actions"><button className="btn secondary compact" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setStatus('Link copied') } catch { setStatus('Select the link to copy it') }
      }}><Copy size={15}/> Copy link</button><a className="btn secondary compact" href={path} target="_blank" rel="noreferrer">Open <ExternalLink size={15}/></a></div>
      <span role="status" className="muted">{status}</span>
    </div>
  </section>
}
