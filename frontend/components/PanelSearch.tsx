'use client'

// Search box shown under a sidebar panel's header, also while the panel is
// collapsed: typing opens the panel on the matches, clearing it folds it back.
export default function PanelSearch({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 pointer-events-none">🔍</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onChange('') }}
        placeholder={placeholder}
        className="w-full bg-white border border-gray-200 text-gray-800 rounded pl-7 pr-6 py-1 text-xs placeholder-gray-400 focus:outline-none focus:border-blue-400"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} title="Clear"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm leading-none">×</button>
      )}
    </div>
  )
}
