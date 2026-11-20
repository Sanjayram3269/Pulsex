export function ThemeSelect({ value, onChange }: {value: string; onChange: (theme: string)=>void}) {
  return <label>Presentation theme<select value={value} onChange={e=>onChange(e.target.value)}>
    <option value="obsidian">Obsidian · Violet</option><option value="aurora">Aurora · Mint</option><option value="ember">Ember · Copper</option>
  </select></label>
}
