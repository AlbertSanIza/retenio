'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useMutation, usePaginatedQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Check, Flag } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const reasons = { confusing: 'Confusing wording', answer: 'Answer seems wrong', image: 'Image issue' }
type Reason = keyof typeof reasons
async function confirmSave<T>(action: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            action,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), 12000)
            })
        ])
    } finally {
        clearTimeout(timer)
    }
}
function errorText(error: unknown) {
    return error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Could not confirm the change. Check your connection and retry safely.'
}
export function ReportQuestion({ cardId, connected }: { cardId: string; connected: boolean }) {
    const submit = useMutation(api.reports.submit)
    const [open, setOpen] = useState(false),
        [reason, setReason] = useState<Reason>('confusing'),
        [note, setNote] = useState('')
    const [saving, setSaving] = useState(false),
        [saved, setSaved] = useState(''),
        [error, setError] = useState('')
    const confirmation = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (saved) confirmation.current?.focus()
    }, [saved])
    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen)
                if (nextOpen) {
                    setSaved('')
                    setError('')
                }
            }}
        >
            <DialogTrigger render={<Button variant="ghost" className="h-11 text-xs text-muted-foreground" />}>
                <Flag className="size-3.5" />
                Something’s off
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-md">
                <DialogTitle>Something’s off</DialogTitle>
                <DialogDescription>Leave a note for your shared library. Reporting keeps the question and its review schedule unchanged.</DialogDescription>
                {saved ? (
                    <div ref={confirmation} tabIndex={-1} role="status" className="space-y-4">
                        <p>{saved}</p>
                        <Button className="h-11 w-full" onClick={() => setOpen(false)}>
                            Keep studying
                        </Button>
                    </div>
                ) : (
                    <form
                        className="space-y-4"
                        onSubmit={async (e) => {
                            e.preventDefault()
                            if (saving || !connected) return
                            setSaving(true)
                            setError('')
                            try {
                                const result = await confirmSave(submit({ cardId, reason, note }))
                                setSaved(
                                    result.alreadyReported
                                        ? 'This question already has an open report. Find it in Card reports.'
                                        : 'Report saved. You can find it in Card reports.'
                                )
                            } catch (cause) {
                                setError(errorText(cause))
                            } finally {
                                setSaving(false)
                            }
                        }}
                    >
                        <label className="block space-y-2">
                            <span className="text-sm font-medium">What needs a look?</span>
                            <select
                                className="h-11 w-full rounded-lg border bg-background px-3"
                                value={reason}
                                onChange={(e) => setReason(e.target.value as Reason)}
                                disabled={saving}
                            >
                                {Object.entries(reasons).map(([key, label]) => (
                                    <option key={key} value={key}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block space-y-2">
                            <span className="text-sm font-medium">Note (optional)</span>
                            <textarea
                                className="min-h-24 w-full resize-y rounded-lg border bg-background p-3"
                                maxLength={500}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                disabled={saving}
                                placeholder="What would make this clearer?"
                            />
                        </label>
                        {error && (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        )}
                        {!connected && (
                            <p role="status" className="text-sm text-muted-foreground">
                                Reconnect to save your report.
                            </p>
                        )}
                        <Button type="submit" className="h-11 w-full" disabled={saving || !connected}>
                            {saving ? 'Saving…' : 'Save report'}
                        </Button>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}
export function CardReports({ connected }: { connected: boolean }) {
    const { results, status, loadMore } = usePaginatedQuery(api.reports.list, {}, { initialNumItems: 10 })
    const resolve = useMutation(api.reports.resolve)
    const heading = useRef<HTMLHeadingElement>(null)
    const [saving, setSaving] = useState<Id<'reports'> | null>(null),
        [error, setError] = useState('')
    return (
        <section aria-label="Card reports" className="mx-auto max-w-3xl space-y-5">
            <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
                    <Flag className="size-4" />A little clearer, every time
                </p>
                <h1 ref={heading} tabIndex={-1} className="text-2xl font-medium">
                    Card reports
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Questions to take another look at. Mark a report resolved when you’ve checked it; this does not edit the question or change its next review.
                </p>
            </div>
            {error && (
                <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">
                    {error}
                </p>
            )}
            {status === 'LoadingFirstPage' ? (
                <p role="status">Loading reports…</p>
            ) : !results.length ? (
                <Card className="items-center p-8 text-center">
                    <Check className="size-8 text-primary/60" />
                    <h2 className="font-medium">Nothing needs a look right now.</h2>
                    <p className="text-sm text-muted-foreground">After revealing an answer, use “Something’s off” to save a report here.</p>
                </Card>
            ) : (
                <ul className="space-y-3">
                    {results.map((report) => (
                        <li key={report._id}>
                            <Card className="gap-3 p-5">
                                <p className="text-xs wrap-anywhere text-muted-foreground">{report.categories.join(' / ')}</p>
                                <h2 className="text-base font-medium wrap-anywhere">{report.question || 'Image question'}</h2>
                                <p className="text-xs font-medium text-primary">{reasons[report.reason]}</p>
                                {report.note && <p className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap">{report.note}</p>}
                                <Button
                                    variant="outline"
                                    className="h-11 self-start"
                                    disabled={!connected || !!saving}
                                    onClick={async () => {
                                        setSaving(report._id)
                                        setError('')
                                        try {
                                            await confirmSave(resolve({ id: report._id }))
                                            heading.current?.focus({ preventScroll: true })
                                        } catch (cause) {
                                            setError(errorText(cause))
                                        } finally {
                                            setSaving(null)
                                        }
                                    }}
                                >
                                    {saving === report._id ? 'Saving…' : 'Mark resolved'}
                                </Button>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
            {!connected && (
                <p role="status" className="text-sm text-muted-foreground">
                    Reconnect to resolve reports.
                </p>
            )}
            {status === 'CanLoadMore' && (
                <Button variant="outline" className="h-11" onClick={() => loadMore(10)}>
                    More reports
                </Button>
            )}
            {status === 'LoadingMore' && <p role="status">Loading more reports…</p>}
        </section>
    )
}
