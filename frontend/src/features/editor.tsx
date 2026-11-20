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
  choices:z.array(z.string().trim().max(80)).max(8),
  type:z.enum(['single_choice','multiple_choice','rating','ranked_choice','word_cloud']),
  min:z.number().int().min(1).max(8), max:z.number().int().min(1).max(10),
  visibility:z.enum(['live','after_close','private']), guests:z.boolean(), opens:z.string(), closes:z.string(),
}).superRefine((x,ctx) => {
  const options = x.type !== 'rating' && x.type !== 'word_cloud'
  if (options && (x.choices.length < 2 || x.choices.some(v=>!v) || new Set(x.choices.map(v=>v.toLowerCase())).size !== x.choices.length)) {
    ctx.addIssue({code:'custom',path:['choices'],message:'Enter 2–8 different choices.'})
  }
  if (x.type === 'multiple_choice' && (x.max < x.min || x.max > x.choices.length)) {
    ctx.addIssue({code:'custom',path:['max'],message:'Selection limits must fit the available choices.'})
  }
  if (x.type === 'rating' && x.max < 3) ctx.addIssue({code:'custom',path:['max'],message:'A rating scale needs at least three values.'})
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
    title:poll?.title ?? '',description:poll?.description ?? '',
    choices:poll?.question?.type === 'rating' || poll?.question?.type === 'word_cloud' ? ['',''] : poll?.choices ?? ['',''],
    type:poll?.question?.type ?? 'single_choice',min:poll?.question?.min ?? 1,max:poll?.question?.max ?? 2,
    visibility:poll?.visibility ?? 'live',guests:poll?.guests ?? true,opens:localDate(poll?.opens),closes:localDate(poll?.closes),
  }})
  const preview = useWatch({control:form.control})
  const usesChoices = preview.type !== 'rating' && preview.type !== 'word_cloud'
  const previewChoices = preview.type === 'rating' ? Array.from({length:Math.max(0,Math.min(preview.max ?? 5,10))},(_,i)=>String(i+1)) : preview.choices
  return <><Heading eyebrow="PULSE STUDIO" title={poll ? 'Edit your draft' : 'Create a poll'}>Set up a question and preview what your audience will see.</Heading>
    <div className="content-grid editor-grid"><form className="panel form-stack" onSubmit={form.handleSubmit(async data => {
      setError(undefined)
      try {
        const result = await api<Poll>(poll ? '/polls/'+poll.id : '/polls', poll ? 'PUT' : 'POST', {
          title:data.title, description:data.description, guests:data.guests, visibility:data.visibility,
          question:{version:1,type:data.type,
            min:data.type === 'rating' ? 1 : data.type === 'multiple_choice' ? data.min : undefined,
            max:data.type === 'rating' || data.type === 'multiple_choice' ? data.max : undefined},
          choices: usesChoices ? data.choices : [],
          opens:data.opens ? new Date(data.opens).toISOString() : null,closes:data.closes ? new Date(data.closes).toISOString() : null,
        })
        query.setQueryData(['poll',result.id],result)
        void query.invalidateQueries({queryKey:['polls']})
        navigate('/studio/polls/'+result.id)
      } catch (err) { setError(err) }
    })}>
      <h2>Question and choices</h2>
      <label>Question<input placeholder="What should we explore next?" maxLength={140} {...form.register('title')}/>{form.formState.errors.title && <small role="alert">{form.formState.errors.title.message}</small>}</label>
      <label>Description <span className="muted">(optional)</span><textarea rows={3} maxLength={1000} placeholder="Add context for your audience" {...form.register('description')}/></label>
      <label>Question type<select {...form.register('type',{
        onChange:e=>{
          form.setValue('min',1)
          form.setValue('max',e.target.value === 'rating' ? 5 : 2)
        },
      })}>
        <option value="single_choice">Single choice</option><option value="multiple_choice">Multiple choice</option>
        <option value="rating">Rating scale</option><option value="ranked_choice">Ranked choice</option><option value="word_cloud">Word cloud</option>
      </select></label>
      {preview.type === 'multiple_choice' && <div className="field-grid">
        <label>Minimum selections<input type="number" min={1} max={8} {...form.register('min',{valueAsNumber:true})}/>{form.formState.errors.min && <small role="alert">{form.formState.errors.min.message}</small>}</label>
        <label>Maximum selections<input type="number" min={1} max={8} {...form.register('max',{valueAsNumber:true})}/>{form.formState.errors.max && <small role="alert">{form.formState.errors.max.message}</small>}</label>
      </div>}
      {preview.type === 'rating' && <label>Highest rating<input type="number" min={3} max={10} {...form.register('max',{valueAsNumber:true})}/>{form.formState.errors.max && <small role="alert">{form.formState.errors.max.message}</small>}</label>}
      {preview.type === 'word_cloud' && <p className="muted">Each participant can submit one phrase. Approve submissions from poll details to publish them.</p>}
      {usesChoices && <Controller control={form.control} name="choices" render={({field,fieldState})=><fieldset className="form-stack">
        <legend>Choices</legend>
        {field.value.map((choice,i)=><div className="choice-edit" key={i}><label className="sr-only" htmlFor={'choice-'+i}>Choice {i+1}</label><input id={'choice-'+i} placeholder={'Choice '+(i+1)} value={choice} maxLength={80} onBlur={field.onBlur} onChange={e=>field.onChange(field.value.map((v,j)=>i===j ? e.target.value : v))}/>
          <button type="button" className="btn icon secondary" aria-label={'Remove choice '+(i+1)} disabled={field.value.length<=2} onClick={()=>field.onChange(field.value.filter((_,j)=>i!==j))}><Trash2 size={17}/></button></div>)}
        {fieldState.error && <small role="alert">{fieldState.error.message ?? 'Fill in every choice.'}</small>}
        <button type="button" className="btn secondary compact align-start" onClick={()=>field.onChange([...field.value,''])} disabled={field.value.length>=8}><Plus size={16}/> Add choice</button>
      </fieldset>}/>}
      <hr/><h2>Voting and results</h2>
      <label>Audience results<select {...form.register('visibility')}><option value="live">Show live</option><option value="after_close">Show after closing</option><option value="private">Creator only</option></select></label>
      <label className="check"><input type="checkbox" {...form.register('guests')}/> Allow voting without an account</label>
      <div className="field-grid"><label>Open at <span className="muted">(optional)</span><input type="datetime-local" {...form.register('opens')}/></label>
        <label>Close at <span className="muted">(optional)</span><input type="datetime-local" {...form.register('closes')}/>{form.formState.errors.closes && <small role="alert">{form.formState.errors.closes.message}</small>}</label></div>
      {error !== undefined && <ErrorBox error={error}/>}
      <button className="btn primary align-start" disabled={form.formState.isSubmitting}>Save draft</button>
    </form>
    <aside className="panel preview"><p className="eyebrow"><Eye size={16}/> AUDIENCE PREVIEW</p><Badge state="draft"/><h2>{preview.title || 'Your question'}</h2>{preview.description && <p className="muted">{preview.description}</p>}
      {preview.type === 'word_cloud' ? <p className="notice">Your word or short phrase</p> :
        <div className="option-stack">{previewChoices?.map((v,i)=><div className="option preview-choice" key={i}>{preview.type === 'ranked_choice' ? (i+1)+'.' : <span className="radio-dot"/>}{v || 'Choice '+(i+1)}</div>)}</div>}
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
