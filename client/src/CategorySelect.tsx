import { channelCategories, UNCLASSIFIED } from "@shared/channelCategories";

export function CategorySelect({ channel, value, onChange, filter = false, disabled = false }: {
  channel: string; value: string; onChange: (value: string) => void; filter?: boolean; disabled?: boolean;
}) {
  return <label className="field">소분류<select aria-label={filter ? "소분류 필터" : "소분류"} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    <option value="">{filter ? "모든 소분류" : UNCLASSIFIED}</option>
    {filter && <option value={UNCLASSIFIED}>{UNCLASSIFIED}</option>}
    {channelCategories(channel).map(category => <option key={category} value={category}>{category}</option>)}
  </select></label>;
}
