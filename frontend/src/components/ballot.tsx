import { useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import type { Ballot, Poll } from '../types/types'
import { ErrorBox } from './ui'

export function BallotForm({ poll, canVote, submit }: {
  poll: Poll; canVote: boolean; submit: (ballot: Ballot) => Promise<void>
}) {
  const type = poll.question?.type ?? 'single_choice'
  const [choice, setChoice] = useState<number>()
  const [selected, setSelected] = useState<number[]>([])
  const [ranking, setRanking] = useState(() => poll.choices.map((_, i) => i))
  const [term, setTerm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const min = poll.question?.min ?? 1
  const max = poll.question?.max ?? 1
  let ballot: Ballot | undefined
  switch (type) {
    case 'multiple_choice':
      if (selected.length >= min && selected.length <= max) ballot = {choices: selected}
      break
    case 'ranked_choice': ballot = {ranking}; break
    case 'word_cloud':
      if (term.trim()) ballot = {text: term}
      break
    case 'rating':
      if (choice !== undefined) ballot = {rating: choice + min}
      break
    case 'single_choice':
      if (choice !== undefined) ballot = {choice}
      break
  }
  function move(index: number, direction: number) {
    const order = [...ranking]
    const other = index + direction
    ;[order[index], order[other]] = [order[other], order[index]]
    setRanking(order)
  }
  return <form className="form-stack vote-form" onSubmit={async event => {
    event.preventDefault()
    if (!canVote || !ballot || busy) return
    setBusy(true)
    setError(undefined)
    try { await submit(ballot) } catch (failure) { setError(failure) } finally { setBusy(false) }
  }}>
    {type === 'word_cloud' ? <label>Your word or short phrase
      <input value={term} maxLength={40} onChange={e => setTerm(e.target.value)} placeholder="Write up to 40 characters"/>
      <small className="muted">The host reviews each response before it appears.</small>
    </label> : type === 'ranked_choice' ? <fieldset>
      <legend>Rank every choice in order of preference</legend>
      <ol className="question-order">{ranking.map((value, i) => <li key={value}>
        <span>{i + 1}. {poll.choices[value]}</span>
        <div className="actions">
          <button type="button" className="btn secondary icon" aria-label={'Move '+poll.choices[value]+' up'} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16}/></button>
          <button type="button" className="btn secondary icon" aria-label={'Move '+poll.choices[value]+' down'} disabled={i === ranking.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16}/></button>
        </div>
      </li>)}</ol>
    </fieldset> : <fieldset className={'option-stack '+(type === 'rating' ? 'rating-options' : '')}>
      <legend>{type === 'multiple_choice' ? (min === max ? 'Choose '+min : 'Choose '+min+'–'+max+' answers') : type === 'rating' ? 'Choose a rating from '+min+' to '+max : 'Choose one answer'}</legend>
      {poll.choices.map((label, i) => {
        const multiple = type === 'multiple_choice'
        const checked = multiple ? selected.includes(i) : choice === i
        return <label key={i} className={'option '+(checked ? 'selected' : '')}>
          <input type={multiple ? 'checkbox' : 'radio'} name="choice" value={i} checked={checked}
            disabled={multiple && !checked && selected.length >= max}
            onChange={() => multiple ? setSelected(checked ? selected.filter(v => v !== i) : [...selected,i]) : setChoice(i)}/>
          <span>{label}</span>
        </label>
      })}
    </fieldset>}
    {error !== undefined && <ErrorBox error={error}/>}
    <button className="btn primary" disabled={!canVote || !ballot || busy}>Cast vote <ArrowRight size={16}/></button>
  </form>
}
