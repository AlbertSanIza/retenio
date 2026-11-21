'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { withTimeout } from '@/lib/async'
import { convexErrorMessage } from '@/lib/convex-errors'
import { isDue, reviewIntervals, type ReviewRating } from '@/lib/review-schedule'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { ArrowLeft, ArrowRight, Check, Clock3, MessageCircle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { StudyCard } from './study-card'
import { useNow } from './use-now'

function when(timestamp: number) {
    return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
export function AgentSessions({
    canSave,
    onStudying,
    reportQuestion
}: {
    canSave: boolean
    onStudying: (studying: boolean) => void
    reportQuestion?: (cardId: string) => ReactNode
}) {
    // Keep pagination stable while browsing. Scheduled expiry and the UI clock remove expired sessions.
    const [asOf] = useState(() => Date.now())
    const { results, status, loadMore } = usePaginatedQuery(api.sessions.list, { asOf }, { initialNumItems: 6 })
    const [sessionId, setSessionId] = useState<Id<'agentSessions'> | null>(null)
    const session = useQuery(api.sessions.get, sessionId ? { sessionId, asOf } : 'skip')
    const rate = useMutation(api.sessions.rate)
    const [cardId, setCardId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const now = useNow()
    const active = session && session.expiresAt > now ? session : null
    const entry = active?.entries.find((e) => e.card.id === cardId)
    const studying = !!entry
    useEffect(() => {
        onStudying(studying)
        return () => onStudying(false)
    }, [studying, onStudying])
    async function submit(rating: ReviewRating) {
        if (!entry || !sessionId || saving) return
        setSaving(true)
        setError(null)
        try {
            await withTimeout(rate({ sessionId, cardId: entry.card.id, rating }))
            const next = active?.entries.find((e) => e.card.id !== entry.card.id && !e.rating && e.available && e.approved && isDue(e.currentDueAt, Date.now()))
            setCardId(next?.card.id ?? null)
        } catch (cause) {
            setError(convexErrorMessage(cause, 'Confirmation delayed. This session will update when your connection returns. You can safely retry.'))
        } finally {
            setSaving(false)
        }
    }
    if (entry) {
        const notice = entry.rating
            ? `Rated ${reviewIntervals[entry.rating].label} · Scheduled for ${when(entry.dueAt!)}`
            : !entry.available
              ? 'This question is no longer in your library.'
              : !entry.approved
                ? 'This question was removed from agent practice.'
                : !isDue(entry.currentDueAt, now)
                  ? `Already reviewed elsewhere. Next review ${when(entry.currentDueAt!)}`
                  : undefined
        return (
            <div className="mx-auto max-w-3xl pb-[calc(11rem+env(safe-area-inset-bottom))] lg:pb-0">
                <StudyCard
                    key={`${sessionId}:${entry.card.id}`}
                    card={entry.card}
                    reportAction={reportQuestion?.(entry.card.id)}
                    approved={entry.approved}
                    saving={saving}
                    busy={false}
                    canSave={canSave && !notice}
                    ratingNotice={notice}
                    error={error}
                    backLabel="Back to session"
                    backText="Session"
                    onClose={() => {
                        setCardId(null)
                        setError(null)
                    }}
                    onReveal={() => {}}
                    onRate={submit}
                />
            </div>
        )
    }
    return (
        <section aria-label="Recent agent practice" className="mx-auto max-w-3xl space-y-5">
            {sessionId ? (
                <>
                    <Button
                        variant="ghost"
                        className="h-11"
                        onClick={() => {
                            setSessionId(null)
                            setCardId(null)
                            setError(null)
                        }}
                    >
                        <ArrowLeft className="size-4" />
                        All sessions
                    </Button>
                    {session === undefined ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            Loading your session…
                        </p>
                    ) : !active ? (
                        <Card className="p-6">
                            <p>This session has expired. Sessions are kept for 72 hours.</p>
                        </Card>
                    ) : (
                        <>
                            <div>
                                <p className="text-xs text-muted-foreground">Agent practice · {when(active.createdAt)}</p>
                                <h1 className="mt-2 text-2xl font-medium">Pick up where you left off.</h1>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    The questions your agent pulled, saved as they appeared. Reveal an answer to choose its next review.
                                </p>
                            </div>
                            <Card className="gap-0 overflow-hidden py-0">
                                <ul className="divide-y">
                                    {active.entries.map((item) => (
                                        <li key={item.card.id}>
                                            <button
                                                type="button"
                                                className="flex min-h-20 w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/50 focus-visible:outline-ring"
                                                onClick={() => {
                                                    setCardId(item.card.id)
                                                    setError(null)
                                                }}
                                            >
                                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                    {item.rating ? <Check className="size-4" /> : <MessageCircle className="size-4" />}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-medium">{item.card.question.text || 'Image question'}</span>
                                                    <span className="mt-1 block text-xs text-muted-foreground">
                                                        {item.rating
                                                            ? `Rated ${reviewIntervals[item.rating].label}`
                                                            : !item.available
                                                              ? 'No longer available'
                                                              : !item.approved
                                                                ? 'Removed from practice'
                                                                : !isDue(item.currentDueAt, now)
                                                                  ? `Next review ${when(item.currentDueAt!)}`
                                                                  : 'Not rated yet'}
                                                    </span>
                                                </span>
                                                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </Card>
                        </>
                    )}
                </>
            ) : (
                <>
                    <div>
                        <p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
                            <MessageCircle className="size-4" />
                            Your conversations, continued
                        </p>
                        <h1 className="text-2xl font-medium tracking-tight">Recent agent practice</h1>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Every question batch your agent requests appears here. Revisit the last three days and choose your next review.
                        </p>
                    </div>
                    {status === 'LoadingFirstPage' ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            Loading recent sessions…
                        </p>
                    ) : results.filter((s) => s.expiresAt > now).length === 0 ? (
                        <Card className="items-center p-8 text-center">
                            <MessageCircle className="size-8 text-primary/60" />
                            <h2 className="font-medium">Your next conversation starts here.</h2>
                            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                                Ask your agent for practice questions. Each batch will appear here automatically.
                            </p>
                        </Card>
                    ) : (
                        <ul className="space-y-3">
                            {results
                                .filter((s) => s.expiresAt > now)
                                .map((s) => (
                                    <li key={s.id}>
                                        <button
                                            type="button"
                                            className="flex min-h-20 w-full items-center gap-4 rounded-xl border bg-card px-5 py-4 text-left hover:bg-muted/40 focus-visible:outline-ring"
                                            onClick={() => setSessionId(s.id)}
                                        >
                                            <Clock3 className="size-5 shrink-0 text-primary" />
                                            <span className="flex-1">
                                                <span className="block text-sm font-medium">{when(s.createdAt)}</span>
                                                <span className="mt-1 block text-xs text-muted-foreground">
                                                    {s.count} {s.count === 1 ? 'question' : 'questions'} · {s.reviewedCount} rated
                                                </span>
                                            </span>
                                            <ArrowRight className="size-4 text-muted-foreground" />
                                        </button>
                                    </li>
                                ))}
                        </ul>
                    )}
                    {status === 'CanLoadMore' && (
                        <Button variant="outline" onClick={() => loadMore(6)}>
                            Earlier sessions
                        </Button>
                    )}
                    {status === 'LoadingMore' && (
                        <p role="status" className="text-sm text-muted-foreground">
                            Loading earlier sessions…
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Session history expires after 72 hours. Your saved ratings and review dates stay in your library.
                    </p>
                </>
            )}
        </section>
    )
}
