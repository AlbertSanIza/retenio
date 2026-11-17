'use client'

import type { CategoryNode, CollectionTree } from '@/lib/study'
import { matchesCategory } from '@/lib/study'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Layers3 } from 'lucide-react'
import { useState } from 'react'

type Selection = { collection?: string; category: string[] }
type Props = { collections: CollectionTree[]; selection: Selection; onSelect: (selection: Selection) => void; total: number }

function Topic({
    node,
    collection,
    selection,
    onSelect,
    depth = 0
}: { node: CategoryNode; collection: string; depth?: number } & Pick<Props, 'selection' | 'onSelect'>) {
    const selected = selection.collection === collection && JSON.stringify(selection.category) === JSON.stringify(node.path)
    const selectionKey = JSON.stringify([selection.collection, selection.category])
    const [expansion, setExpansion] = useState<{ selectionKey: string; open: boolean } | null>(null)
    const containsSelection =
        selection.collection === collection && selection.category.length > node.path.length && matchesCategory(selection.category, node.path)
    const open = expansion?.selectionKey === selectionKey ? expansion.open : containsSelection
    return (
        <li>
            <div
                className={cn('group/topic flex items-center rounded-lg transition-colors hover:bg-muted', selected && 'bg-primary/10 text-primary')}
                style={{ paddingLeft: depth * 12 }}
            >
                {node.children.length > 0 ? (
                    <button
                        type="button"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
                        aria-expanded={open}
                        onClick={() => setExpansion({ selectionKey, open: !open })}
                    >
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                ) : (
                    <span className="w-8 shrink-0" />
                )}
                <button
                    type="button"
                    aria-pressed={selected}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2.5 pr-2 text-left text-[13px] leading-snug focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelect({ collection, category: node.path })}
                >
                    <span className="flex-1">{node.name}</span>
                    <span className="text-[11px] tabular-nums opacity-60">{node.count}</span>
                </button>
            </div>
            {open && node.children.length > 0 && (
                <ul className="mt-0.5 space-y-0.5">
                    {node.children.map((child) => (
                        <Topic
                            key={JSON.stringify(child.path)}
                            node={child}
                            collection={collection}
                            selection={selection}
                            onSelect={onSelect}
                            depth={depth + 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    )
}

export function CategoryTree({ collections, selection, onSelect, total }: Props) {
    return (
        <nav aria-label="Study topics" className="space-y-5">
            <button
                type="button"
                aria-pressed={!selection.collection}
                className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring',
                    !selection.collection ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                )}
                onClick={() => onSelect({ collection: undefined, category: [] })}
            >
                <Layers3 className="size-4" />
                <span className="flex-1 text-left">All questions</span>
                <span className="text-xs tabular-nums opacity-70">{total.toLocaleString()}</span>
            </button>
            {collections.map((collection) => (
                <div key={collection.id}>
                    <button
                        type="button"
                        onClick={() => onSelect({ collection: collection.id, category: [] })}
                        aria-pressed={selection.collection === collection.id && !selection.category.length}
                        className="mb-2 w-full rounded px-2 text-left text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {collection.name}
                    </button>
                    <ul className="space-y-0.5">
                        {collection.categories.map((node) => (
                            <Topic key={JSON.stringify(node.path)} node={node} collection={collection.id} selection={selection} onSelect={onSelect} />
                        ))}
                    </ul>
                </div>
            ))}
        </nav>
    )
}
