import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowRight } from 'lucide-react'
import { z } from 'zod'
import { Brand, ErrorBox, Heading } from '../components/ui'
import { api, useUser } from '../services/api'
import type { User } from '../types/types'

const credentials = z.object({
  name: z.string().trim(),
  email: z.email('Enter a valid email.'),
  password: z.string().min(1, 'Enter a password.').refine(v => new TextEncoder().encode(v).length <= 72, 'Use 72 bytes or fewer.'),
})
export function Identity({ register }: { register: boolean }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const client = useQueryClient()
  const [failure, setFailure] = useState<unknown>()
  const form = useForm({resolver: zodResolver(credentials), defaultValues: {name:'',email:'',password:''}})
  const next = params.get('next') ?? '/studio'
  const destination = /^\/(?![\\/])/.test(next) ? next : '/studio'
  return <div className="auth-page"><header className="wrap landing-nav"><Brand/><Link to={register ? '/login' : '/register'} className="btn secondary compact">{register ? 'Sign in' : 'Create account'}</Link></header>
    <main id="main" tabIndex={-1} className="auth-wrap">
      <section className="panel auth-card">
        <span className="feature-icon"><Activity/></span>
        <Heading eyebrow="PULSE IDENTITY" title={register ? 'Start polling.' : 'Welcome back.'}>{register ? 'Create an account to publish polls and host rooms.' : 'Sign in to manage your polls and rooms.'}</Heading>
        <form className="form-stack" onSubmit={form.handleSubmit(async ({name,email,password}) => {
          if (register && (name.length < 2 || name.length > 60)) { form.setError('name', {message:'Use 2–60 characters.'}); return }
          if (register && [...password].length < 10) { form.setError('password', {message:'Use at least 10 characters.'}); return }
          try {
            setFailure(undefined)
            const user = await api<User>(register ? '/auth/register' : '/auth/login', 'POST', {name,email,password})
            client.setQueryData(['me'], user)
            navigate(destination, {replace:true})
          } catch (err) { setFailure(err) }
        })}>
          {register && <label>Display name<input autoComplete="name" {...form.register('name')}/>{form.formState.errors.name && <small role="alert">{form.formState.errors.name.message}</small>}</label>}
          <label>Email<input type="email" autoComplete="email" {...form.register('email')}/>{form.formState.errors.email && <small role="alert">{form.formState.errors.email.message}</small>}</label>
          <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} {...form.register('password')}/>{form.formState.errors.password && <small role="alert">{form.formState.errors.password.message}</small>}</label>
          {failure !== undefined && <ErrorBox error={failure}/>}
          <button className="btn primary" disabled={form.formState.isSubmitting}>{register ? 'Create account' : 'Sign in'} <ArrowRight size={17}/></button>
        </form>
        <p className="muted auth-foot">{register ? 'Already have an account?' : 'New to PULSEX?'} <Link to={(register ? '/login' : '/register') + '?next='+encodeURIComponent(destination)}>{register ? 'Sign in' : 'Create an account'}</Link></p>
      </section>
    </main></div>
}

export function Settings() {
  const user = useUser()
  const client = useQueryClient()
  const [name,setName] = useState(user.data?.name ?? '')
  const [pending,setPending] = useState(false)
  const [saved,setSaved] = useState(false)
  const [error,setError] = useState<unknown>()
  useEffect(() => { setName(user.data?.name ?? '') }, [user.data?.name])
  return <><Heading eyebrow="ACCOUNT" title="Settings">Manage how your name appears in your workspace.</Heading>
    <section className="panel narrow"><h2>Profile</h2>
      <form className="form-stack" onSubmit={async e => {
        e.preventDefault();setError(undefined);setSaved(false);setPending(true)
        try { await api('/auth/me','PATCH',{name}); await client.invalidateQueries({queryKey:['me']}); setSaved(true) }
        catch (err) { setError(err) } finally { setPending(false) }
      }}>
        <label>Email<input readOnly value={user.data?.email ?? ''}/></label>
        <label>Display name<input value={name} required minLength={2} maxLength={60} onChange={e => {setName(e.target.value);setSaved(false)}}/></label>
        {error !== undefined && <ErrorBox error={error}/>}
        <div className="actions"><button className="btn primary" disabled={pending}>Save profile</button><span role="status">{saved && 'Profile saved'}</span></div>
      </form>
    </section></>
}
