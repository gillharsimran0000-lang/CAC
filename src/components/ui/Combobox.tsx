"use client"

/**
 * A select you can type into.
 *
 * The lab's place picker was a native `<select>` holding every zone in the
 * area. At metro scale that is three hundred options; statewide it is seventy
 * five counties, and the block-group models run to two thousand. A native
 * select is genuinely good at ten options and unusable past a hundred: you
 * cannot see what you are looking for, and the browser's own type-ahead only
 * matches from the start of the string, so "Fayetteville" finds nothing when
 * the option reads "Washington County, tract 105.02".
 *
 * So: type, and the list narrows on every word, anywhere in the row. That is
 * the whole feature. It is deliberately not a fuzzy matcher -- somebody typing
 * "412" wants Highway 412, and a matcher clever enough to also offer 421
 * because the digits are close is worse than a plain filter, not better.
 *
 * Keyboard behaviour follows the ARIA combobox pattern rather than being
 * invented: down and up move the active option, enter takes it, escape closes
 * and restores what was selected. `aria-activedescendant` is what makes that
 * legible to a screen reader, because focus stays in the input the whole time.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react"

export interface ComboboxItem {
    key: string
    label: string
    /** Right-aligned figure: a population, a length, a count. */
    hint?: string
}

export function Combobox({
    items,
    value,
    onChange,
    label,
    placeholder = "type to search",
    /** Rows rendered at once. The rest are still reachable by typing. */
    limit = 60,
    accent = "var(--color-accent)",
}: {
    items: ComboboxItem[]
    /** Key of the selected item, or "" for none. */
    value: string
    onChange: (key: string) => void
    label: string
    placeholder?: string
    limit?: number
    accent?: string
}) {
    const id = useId()
    const [query, setQuery] = useState("")
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(0)
    const rootRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLUListElement>(null)

    const selected = items.find((i) => i.key === value) ?? null

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return items.slice(0, limit)
        const terms = q.split(/\s+/)
        const out: ComboboxItem[] = []
        for (const item of items) {
            const hay = `${item.label} ${item.hint ?? ""}`.toLowerCase()
            if (terms.every((t) => hay.includes(t))) out.push(item)
            if (out.length >= limit) break
        }
        return out
    }, [items, query, limit])

    /* The highlight is clamped rather than reset from an effect. Typing
       narrows the list under the cursor, and an index left pointing past the
       new end would make the first arrow press jump somewhere arbitrary; the
       handlers below put it back to the top, and this catches the rest. */
    const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0))

    // Click anywhere else and the list closes without changing the selection.
    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(false)
                setQuery("")
            }
        }
        document.addEventListener("mousedown", onDown)
        return () => document.removeEventListener("mousedown", onDown)
    }, [open])

    // Keep the active row in view when it is moved by the keyboard.
    useEffect(() => {
        if (!open) return
        listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" })
    }, [activeIndex, open])

    const commit = (item: ComboboxItem | undefined) => {
        if (!item) return
        onChange(item.key)
        setOpen(false)
        setQuery("")
    }

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            if (!open) {
                setActive(0)
                setOpen(true)
                return
            }
            const step = e.key === "ArrowDown" ? 1 : -1
            setActive((a) => {
                const from = Math.min(a, Math.max(filtered.length - 1, 0))
                return (from + step + filtered.length) % Math.max(filtered.length, 1)
            })
        } else if (e.key === "Enter") {
            if (open) {
                e.preventDefault()
                commit(filtered[activeIndex])
            }
        } else if (e.key === "Escape") {
            setOpen(false)
            setQuery("")
        }
    }

    return (
        <div ref={rootRef} className="relative">
            <label htmlFor={id} className="sr-only">
                {label}
            </label>
            <input
                id={id}
                role="combobox"
                aria-expanded={open}
                aria-controls={`${id}-list`}
                aria-autocomplete="list"
                aria-activedescendant={
                    open && filtered[activeIndex] ? `${id}-o${activeIndex}` : undefined
                }
                autoComplete="off"
                /* The input shows the selection until you start typing, then it
                   shows what you typed. One field doing both jobs is what makes
                   this feel like a select rather than a search box beside one. */
                value={open ? query : (selected?.label ?? "")}
                placeholder={selected ? selected.label : placeholder}
                onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                    setOpen(true)
                }}
                onFocus={() => {
                    setActive(0)
                    setQuery("")
                    setOpen(true)
                }}
                /* Click as well as focus, and they are not the same event.
                   Committing a choice leaves the field focused but closed, so a
                   second click fires no focus event: the list stayed shut and
                   the next keystroke appended to the label of the thing already
                   chosen. Picking Phillips and then typing Newton gave you
                   "PhillipsNewton" and no matches, which looks like the search
                   is broken rather than like the field kept its old text. */
                onClick={() => {
                    if (!open) {
                        setActive(0)
                        setQuery("")
                        setOpen(true)
                    }
                }}
                onKeyDown={onKeyDown}
                className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-[12px] text-paper-100 placeholder:text-paper-400 focus-visible:border-accent focus-visible:outline-none"
            />

            {open && (
                <ul
                    ref={listRef}
                    id={`${id}-list`}
                    role="listbox"
                    aria-label={label}
                    className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-ink-600 bg-ink-950 py-1 shadow-xl"
                >
                    {filtered.length === 0 && (
                        <li className="px-2.5 py-2 text-[11px] text-paper-400">
                            Nothing matches {`"${query}"`}.
                        </li>
                    )}
                    {filtered.map((item, i) => (
                        <li
                            key={item.key}
                            id={`${id}-o${i}`}
                            role="option"
                            aria-selected={item.key === value}
                            onMouseEnter={() => setActive(i)}
                            onMouseDown={(e) => {
                                // mousedown, not click: the blur that click
                                // fires after would close the list first.
                                e.preventDefault()
                                commit(item)
                            }}
                            className={`flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5 text-[11px] ${
                                i === activeIndex ? "bg-ink-800" : ""
                            }`}
                            style={
                                i === activeIndex ? { boxShadow: `inset 2px 0 0 ${accent}` } : undefined
                            }
                        >
                            <span className="flex-1 truncate text-paper-200">{item.label}</span>
                            {item.hint && (
                                <span className="tabular shrink-0 font-mono text-[10px] text-paper-400">
                                    {item.hint}
                                </span>
                            )}
                        </li>
                    ))}
                    {filtered.length >= limit && (
                        <li className="px-2.5 py-1.5 font-mono text-[9px] text-paper-400">
                            showing the first {limit}. keep typing to narrow.
                        </li>
                    )}
                </ul>
            )}
        </div>
    )
}

/**
 * A number you can type OR drag.
 *
 * The slider was the only way to say how many residents, which meant the
 * answer was always a multiple of five hundred and "37,412 people, the actual
 * projection" could not be entered at all. The field and the slider are two
 * views of one value: drag for the feel of the range, type when you know the
 * number.
 *
 * The typed value is clamped on blur rather than on every keystroke, because
 * clamping as you type makes "5" become "500" before you have finished writing
 * "5000", and the field fights you.
 */
export function NumberScrub({
    value,
    onChange,
    min,
    max,
    step,
    label,
    suffix,
    accent = "#7aa5e6",
}: {
    value: number
    onChange: (v: number) => void
    min: number
    max: number
    step: number
    label: string
    suffix?: string
    accent?: string
}) {
    const id = useId()
    const [text, setText] = useState<string | null>(null)

    const commit = () => {
        if (text === null) return
        const parsed = Number(text.replace(/[^\d.-]/g, ""))
        setText(null)
        if (!Number.isFinite(parsed)) return
        onChange(Math.max(min, Math.min(max, Math.round(parsed))))
    }

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2">
                <label
                    htmlFor={id}
                    className="font-mono text-[10px] uppercase tracking-wider text-paper-400"
                >
                    {label}
                </label>
                <div className="flex items-baseline gap-1">
                    <input
                        id={id}
                        inputMode="numeric"
                        value={text ?? value.toLocaleString()}
                        onChange={(e) => setText(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        className="tabular w-20 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-right font-mono text-[11px] text-paper-100 focus-visible:border-accent focus-visible:outline-none"
                    />
                    {suffix && <span className="font-mono text-[10px] text-paper-400">{suffix}</span>}
                </div>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={Math.max(min, Math.min(max, value))}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label={label}
                className="mt-1.5 w-full"
                style={{ accentColor: accent }}
            />
        </div>
    )
}
