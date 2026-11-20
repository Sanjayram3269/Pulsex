import { useState } from 'react'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Eye, Plus, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { Badge, ErrorBox, Heading, Loading } from '../components/ui'
import { api } from '../services/api'
import type { Poll } from '../types/types'
import { usePoll } from './studio'

const schema = z.object({
  title:z.string().trim().min(3,'Enter at least 3 characters.').max(140),
  description:z.string().trim().max(1000),
  choices:z.array(z.string().trim().min(1).max(80)).min(2).max(8).refine(v=>new Set(v.map(x=>x.toLowerCase())).size===v.length,'Choices must be distinct.'),
  visibility:z.enum(['live','after_close','private']), guests:z.boolean(), opens:z.string(), closes:z.string(),
}).refine(x=>!x.opens || !x.closes || x.closes>x.opens,{path:['closes'],message:'Closing time must follow opening time.'})
type Values = z.infer<typeof schema>
const localDate = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
function Form({ poll }: { poll?: Poll }) {
  const [error,setError] = useState<unknown>()
  const navigate = useNavigate()
  const query = useQueryClient()
  const form = useForm<Values>({resolver:zodResolver(schema),defaultValues:{
    title:poll?.title ?? '',description:poll?.description ?? '',choices:poll?.choices ?? ['',''],
    visibility:poll?.visibility ?? 'live',guests:poll?.guests ?? true,opens:localDate(poll?.opens),closes:localDate(poll?.closes),
  }})
  const preview = useWatch({control:form.control})
  return <><Heading eyebrow="PULSE STUDIO" title={poll ? 'Edit your draft' : 'Create a poll'}>Set up a question and preview what your audience will see.</Heading>
    <div className="content-grid editor-grid"><form className="panel form-stack" onSubmit={form.handleSubmit(async data => {
      setError(undefined)
      try {
        const result = await api<Poll>(poll ? '/polls/'+poll.id : '/polls', poll ? 'PUT' : 'POST', {
          ...data,opens:data.opens ? new Date(data.opens).toISOString() : null,closes:data.closes ? new Date(data.closes).toISOString() : null,
        })
        query.setQueryData(['poll',result.id],result)
        void query.invalidateQueries({queryKey:['polls']})
        navigate('/studio/polls/'+result.id)
      } catch (err) { setError(err) }
    })}>
      <h2>Question and choices</h2>
      <label>Question<input placeholder="What should we explore next?" maxLength={140} {...form.register('title')}/>{form.formState.errors.title && <small role="alert">{form.formState.errors.title.message}</small>}</label>
      <label>Description <span className="muted">(optional)</span><textarea rows={3} maxLength={1000} placeholder="Add context for your audience" {...form.register('description')}/></label>
      <Controller control={form.control} name="choices" render={({field,fieldState})=><fieldset className="form-stack">
        <legend>Choices</legend>
        {field.value.map((choice,i)=><div className="choice-edit" key={i}><label className="sr-only" htmlFor={'choice-'+i}>Choice {i+1}</label><input id={'choice-'+i} placeholder={'Choice '+(i+1)} value={choice} maxLength={80} onBlur={field.onBlur} onChange={e=>field.onChange(field.value.map((v,j)=>i===j ? e.target.value : v))}/>
          <button type="button" className="btn icon secondary" aria-label={'Remove choice '+(i+1)} disabled={field.value.length<=2} onClick={()=>field.onChange(field.value.filter((_,j)=>i!==j))}><Trash2 size={17}/></button></div>)}
        {fieldState.error && <small role="alert">{fieldState.error.message ?? 'Fill in every choice.'}</small>}
        <button type="button" className="btn secondary compact align-start" onClick={()=>field.onChange([...field.value,''])} disabled={field.value.length>=8}><Plus size={16}/> Add choice</button>
      </fieldset>}/>
      <hr/><h2>Voting and results</h2>
      <label>Audience results<select {...form.register('visibility')}><option value="live">Show live</option><option value="after_close">Show after closing</option><option value="private">Creator only</option></select></label>
      <label className="check"><input type="checkbox" {...form.register('guests')}/> Allow voting without an account</label>
      <div className="field-grid"><label>Open at <span className="muted">(optional)</span><input type="datetime-local" {...form.register('opens')}/></label>
        <label>Close at <span className="muted">(optional)</span><input type="datetime-local" {...form.register('closes')}/>{form.formState.errors.closes && <small role="alert">{form.formState.errors.closes.message}</small>}</label></div>
      {error !== undefined && <ErrorBox error={error}/>}
      <button className="btn primary align-start" disabled={form.formState.isSubmitting}>Save draft</button>
    </form>
    <aside className="panel preview"><p className="eyebrow"><Eye size={16}/> AUDIENCE PREVIEW</p><Badge state="draft"/><h2>{preview.title || 'Your question'}</h2>{preview.description && <p className="muted">{preview.description}</p>}
      <div className="option-stack">{preview.choices?.map((v,i)=><div className="option preview-choice" key={i}><span className="radio-dot"/>{v || 'Choice '+(i+1)}</div>)}</div>
    </aside></div>
  </>
}
function Existing({ id }: { id: string }) {
  const poll = usePoll(id)
  if (poll.isPending) return <Loading/>
  if (poll.isError) return <ErrorBox error={poll.error}/>
  if (poll.data.state!=='draft') return <ErrorBox error={new Error('Only draft polls can be edited.')}/>
  return <Form key={id} poll={poll.data}/>
}
export function Editor() {
  const id = useParams().id
  return id ? <Existing id={id}/> : <Form/>
}
