'use client'

import { ConvexError } from 'convex/values'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { isDue, type ReviewRating, type ReviewState } from '@/lib/review-schedule'
import type { LibraryCard, LibraryPage, StudyScope } from '@/lib/study'
import { cn } from '@/lib/utils'
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, Layers3, Menu, Search, Shuffle, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CategoryTree } from './category-tree'
import { StudyCard } from './study-card'

export type ApprovalState = {
    ids: string[] | undefined
    reviews?: ReviewState[]
    rate?: (cardId: string, rating: ReviewRating, requestId: string) => Promise<unknown>
    ready: boolean
    unavailable: boolean
    save?: (cardId: string, approved: boolean) => Promise<unknown>
    retry?: () => void
}
const initialScope: StudyScope = { category: [], search: '', status: 'all' }

export function Dashboard({ approvals, importButton, catalogRevision }: { approvals: ApprovalState; importButton?: ReactNode; catalogRevision?: string }) {
    const [scope, setScope] = useState<StudyScope>(initialScope)
    const [page, setPage] = useState(1)
    const [data, setData] = useState<LibraryPage | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [retry, setRetry] = useState(0)
    const [selected, setSelected] = useState<{ card: LibraryCard; revision: number } | null>(null)
    const [busy, setBusy] = useState(false)
    const [studyError, setStudyError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [notice, setNotice] = useState('')
    const [studied, setStudied] = useState<string[]>([])
    const [topicsOpen, setTopicsOpen] = useState(false)
    const [now, setNow] = useState(0)
    const [nextDueAt, setNextDueAt] = useState<number | null>(null)
    const ratingAttempt = useRef<{ cardId: string; rating: ReviewRating; requestId: string } | null>(null)
    const dueById = new Map(approvals.reviews?.map((r) => [r.cardId, r.dueAt]))
    useEffect(() => {
        const initial = setTimeout(() => setNow(Date.now()), 0)
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => {
            clearTimeout(initial)
            clearInterval(timer)
        }
    }, [])
    const requestController = useRef<AbortController | null>(null)
    const studyRef = useRef<HTMLDivElement>(null)
    const studyErrorRef = useRef<HTMLDivElement>(null)
    const selectedId = useRef<string | null>(null)
    const approvedIds = new Set(approvals.ids ?? [])
    const approvedCount = data?.catalogCardIds.filter((id) => approvedIds.has(id)).length
    const approvalFilterKey = scope.status === 'all' ? '' : (approvals.ids ?? []).join('|')

    useEffect(() => {
        const controller = new AbortController()
        const timer = setTimeout(
            () => {
                setLoading(true)
                setError(null)
                const params = new URLSearchParams({ page: String(page), search: scope.search, status: scope.status })
                if (scope.collection) params.set('collection', scope.collection)
                scope.category.forEach((part) => params.append('category', part))
                fetch(`/api/questions?${params}`, { signal: controller.signal })
                    .then(async (response) => {
                        const body = await response.json().catch(() => {
                            throw new Error('Could not load questions. Please try again.')
                        })
                        if (!response.ok) throw new Error(body.error || 'Could not load questions.')
                        if (!controller.signal.aborted) {
                            setData(body)
                            setLoading(false)
                        }
                    })
                    .catch((cause) => {
                        if (!controller.signal.aborted) {
                            setError(cause.message)
                            setLoading(false)
                        }
                    })
            },
            scope.search ? 200 : 0
        )
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [scope, page, retry, approvalFilterKey, catalogRevision])

    useEffect(() => () => requestController.current?.abort(), [])

    useEffect(() => {
        if (!studyError) return
        studyErrorRef.current?.focus({ preventScroll: true })
        studyErrorRef.current?.scrollIntoView({ block: 'start' })
    }, [studyError])

    function changeScope(next: StudyScope) {
        const topicChanged = scope.collection !== next.collection || JSON.stringify(scope.category) !== JSON.stringify(next.category)
        requestController.current?.abort()
        setBusy(false)
        setScope(next)
        setPage(1)
        if (topicChanged) {
            setSelected(null)
            selectedId.current = null
        }
        setStudyError(null)
        setNextDueAt(null)

        setSaveError(null)
        setNotice('')
    }

    async function openQuestion(id?: string, afterRating = false) {
        requestController.current?.abort()
        const controller = new AbortController()
        requestController.current = controller
        setBusy(true)
        setNextDueAt(null)
        setStudyError(null)
        setSaveError(null)
        setNotice('')

        try {
            const response = await fetch(id ? `/api/questions/${encodeURIComponent(id)}` : '/api/questions/random', {
                method: id ? 'GET' : 'POST',
                headers: id ? undefined : { 'Content-Type': 'application/json' },
                body: id ? undefined : JSON.stringify(scope),
                signal: controller.signal
            })
            const body = await response.json().catch(() => {
                throw new Error('Could not load this question. Please try again.')
            })
            if (controller.signal.aborted) return
            if (!response.ok) {
                if (body.code === 'NOT_DUE') setNextDueAt(body.nextDueAt)
                throw new Error(body.error || 'Could not load this question.')
            }
            selectedId.current = body.card.id
            setSelected((previous) => ({ card: body.card, revision: (previous?.revision ?? 0) + 1 }))
            requestAnimationFrame(() => studyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        } catch (cause) {
            if (!controller.signal.aborted) {
                if (afterRating) {
                    setSelected(null)
                    selectedId.current = null
                }
                setStudyError(cause instanceof Error ? cause.message : 'Please try again.')
            }
        } finally {
            if (!controller.signal.aborted) setBusy(false)
        }
    }

    async function removeFromPractice() {
        if (!selected || !approvals.ready || !approvals.save) return
        setSaving(true)
        setSaveError(null)
        const id = selected.card.id
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                approvals.save(id, false),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Save confirmation timed out')), 12000)
                })
            ])
            if (selectedId.current === id) setNotice('Removed. Your agent will no longer ask this question.')
        } catch {
            if (selectedId.current === id) setSaveError('We could not confirm that change. Check your connection and try again.')
        } finally {
            clearTimeout(timeout)
            setSaving(false)
        }
    }

    async function rateQuestion(rating: ReviewRating) {
        if (!selected || !approvals.ready || !approvals.rate || saving) return
        const id = selected.card.id
        if (!ratingAttempt.current || ratingAttempt.current.cardId !== id || ratingAttempt.current.rating !== rating) {
            ratingAttempt.current = { cardId: id, rating, requestId: crypto.randomUUID() }
        }
        setSaving(true)
        setSaveError(null)
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                approvals.rate(id, rating, ratingAttempt.current.requestId),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Review confirmation timed out')), 12000)
                })
            ])
            ratingAttempt.current = null
            if (selectedId.current === id) {
                setRetry((n) => n + 1)
                await openQuestion(undefined, true)
            }
        } catch (cause) {
            if (selectedId.current === id) {
                if (cause instanceof ConvexError && cause.data && typeof cause.data === 'object' && 'code' in cause.data && cause.data.code === 'NOT_DUE') {
                    ratingAttempt.current = null
                    setRetry((n) => n + 1)
                    await openQuestion(undefined, true)
                } else setSaveError('Your review could not be confirmed. Please retry the same rating; it will only be saved once.')
            }
        } finally {
            clearTimeout(timeout)
            setSaving(false)
        }
    }

    const topicTitle = scope.category.at(-1) ?? (scope.collection ? data?.collections.find((item) => item.id === scope.collection)?.name : 'All questions')
    const categoryTree = (
        <CategoryTree
            collections={data?.collections ?? []}
            selection={scope}
            total={data?.totalQuestions ?? 0}
            onSelect={(selection) => {
                changeScope({ ...scope, ...selection })
                setTopicsOpen(false)
            }}
        />
    )

    return (
        <div className="min-h-screen bg-background">
            <header className={cn('border-b bg-card/80', selected && 'hidden lg:block')}>
                <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
                    <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:ring-2 focus-visible:ring-ring" aria-label="Retenio home">
                        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <BookOpen className="size-5" />
                        </span>
                        <span className="text-xl font-semibold tracking-[-0.04em]">
                            retenio<span className="text-primary">.</span>
                        </span>
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {importButton}
                        <span className={cn('size-1.5 rounded-full', approvals.ready ? 'bg-primary' : 'bg-amber-500')} />
                        <span className="hidden sm:inline">
                            {approvals.ready ? 'Your shared learning library' : approvals.unavailable ? 'Study library' : 'Connecting your practice set'}
                        </span>
                    </div>
                </div>
            </header>
            <main
                className={cn(
                    'mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12',
                    selected &&
                        'px-3 pt-3 pb-[calc(11rem+env(safe-area-inset-bottom))] sm:px-5 sm:pt-5 sm:pb-[calc(11rem+env(safe-area-inset-bottom))] lg:px-12 lg:py-10'
                )}
            >
                <section className={cn('mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-end', selected && 'hidden lg:flex')}>
                    <div>
                        <p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-primary uppercase">A little practice, every day</p>
                        <h1 className="text-3xl font-medium tracking-[-0.045em] sm:text-[42px] sm:leading-tight">Make it familiar.</h1>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                            Explore a topic. Think through an answer. Build a practice set that grows with you.
                        </p>
                    </div>
                    <Button
                        size="lg"
                        disabled={busy || saving || !data || loading}
                        onClick={() => openQuestion()}
                        className="h-11 shrink-0 gap-2 px-5 shadow-sm"
                    >
                        <Shuffle className="size-4" />
                        Study a random question
                    </Button>
                </section>
                <div className={cn('mb-8 grid grid-cols-3 gap-2 sm:gap-4', selected && 'hidden lg:grid')}>
                    {[
                        { label: 'Questions to explore', value: data?.totalQuestions.toLocaleString() ?? '—', icon: Layers3 },
                        { label: 'In agent practice', value: approvals.ids && approvedCount !== undefined ? String(approvedCount) : '—', icon: Sparkles },
                        { label: 'Reviewed this session', value: String(studied.length), icon: BookOpen }
                    ].map(({ label, value, icon: Icon }) => (
                        <Card key={label} className="flex flex-row items-center justify-between gap-2 rounded-xl px-3 py-4 shadow-none sm:px-5">
                            <div>
                                <p className="mb-1.5 text-[10px] leading-4 text-muted-foreground sm:text-xs">{label}</p>
                                <p
                                    data-testid={label === 'In agent practice' ? 'practice-count' : undefined}
                                    className="text-xl font-medium tracking-tight tabular-nums sm:text-2xl"
                                >
                                    {value}
                                </p>
                            </div>
                            <span className="hidden size-9 items-center justify-center rounded-lg bg-muted text-primary sm:flex">
                                <Icon className="size-4" />
                            </span>
                        </Card>
                    ))}
                </div>
                {approvals.unavailable && (
                    <div role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        Saving to agent practice is temporarily unavailable. You can still browse questions and study here.
                        {approvals.retry && (
                            <Button variant="ghost" onClick={approvals.retry}>
                                Reconnect practice set
                            </Button>
                        )}
                    </div>
                )}
                <div className="grid items-start gap-7 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
                    <aside className="sticky top-6 hidden rounded-2xl border bg-card p-4 lg:block">
                        <div className="mb-5 flex items-center justify-between px-2">
                            <h2 className="text-sm font-semibold">Choose a topic</h2>
                            <Layers3 className="size-4 text-muted-foreground" />
                        </div>
                        <div className="max-h-[calc(100dvh-160px)] overflow-auto pr-1">
                            {data ? (
                                categoryTree
                            ) : (
                                <div className="space-y-3">
                                    {Array.from({ length: 6 }, (_, i) => (
                                        <Skeleton key={i} className="h-9 w-full" />
                                    ))}
                                </div>
                            )}
                        </div>
                        <p className="mt-5 border-t px-2 pt-4 text-[11px] leading-5 text-muted-foreground">Choose any level to study everything within it.</p>
                    </aside>
                    <div className="min-w-0 space-y-7">
                        <div className={cn('flex items-center gap-2 lg:hidden', selected && 'hidden')}>
                            <Button variant="outline" className="h-10" disabled={!data} onClick={() => setTopicsOpen(true)}>
                                <Menu className="size-4" />
                                Topics
                            </Button>
                            <span className="min-w-0 truncate text-sm text-muted-foreground">{topicTitle}</span>
                        </div>
                        <div ref={studyRef} className="scroll-mt-6">
                            {selected ? (
                                <StudyCard
                                    key={`${selected.card.id}:${selected.revision}`}
                                    card={selected.card}
                                    approved={approvedIds.has(selected.card.id)}
                                    saving={saving}
                                    canSave={approvals.ready}
                                    error={saveError}
                                    busy={busy}
                                    onRemove={removeFromPractice}
                                    onRate={rateQuestion}
                                    onClose={() => {
                                        requestController.current?.abort()
                                        setBusy(false)
                                        setSelected(null)
                                        selectedId.current = null
                                        setNotice('')
                                        setStudyError(null)
                                    }}
                                    onReveal={() => setStudied((ids) => (ids.includes(selected.card.id) ? ids : [...ids, selected.card.id]))}
                                />
                            ) : (
                                <div className="relative overflow-hidden rounded-2xl border border-primary/10 bg-[#eaf1e9] px-6 py-7 sm:px-8 sm:py-9">
                                    <div className="relative z-10 max-w-lg">
                                        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-white/70 text-primary">
                                            <Sparkles className="size-5" />
                                        </span>
                                        <h2 className="text-xl font-medium tracking-tight sm:text-2xl">Start with a little curiosity.</h2>
                                        <p className="mt-2 max-w-md text-sm leading-6 text-[#53655b]">
                                            Pick a topic, or open a question below. Reveal the answer, then choose how well you remembered. Your rating sets its
                                            next review and adds it to agent practice.
                                        </p>
                                        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#53655b]">
                                            {['Think it through', 'Reveal the answer', 'Choose your next review'].map((step, i) => (
                                                <span key={step} className="flex items-center gap-1.5">
                                                    <span className="flex size-4 items-center justify-center rounded-full border border-primary/25 text-[9px]">
                                                        {i + 1}
                                                    </span>
                                                    {step}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <div
                                        aria-hidden="true"
                                        className="pointer-events-none absolute -right-8 -bottom-16 hidden size-56 rounded-full border-[32px] border-white/35 xl:block"
                                    />
                                </div>
                            )}
                            {notice && (
                                <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary">
                                    <Check className="size-4 shrink-0" />
                                    {notice}
                                </p>
                            )}
                            {studyError && (
                                <div ref={studyErrorRef} tabIndex={-1} role="alert" className="mt-3 scroll-mt-4 rounded-xl border bg-card px-4 py-3">
                                    <p className="text-sm" role="status">
                                        {nextDueAt && nextDueAt <= now ? 'A question is ready to review.' : studyError}
                                    </p>
                                    {nextDueAt && (
                                        <p className="mt-2 text-xs text-muted-foreground">
                                            {nextDueAt > now ? `Next review ${new Date(nextDueAt).toLocaleString()}` : 'Continue whenever you are ready.'}
                                        </p>
                                    )}
                                    <Button variant="ghost" className="mt-2" disabled={!!nextDueAt && nextDueAt > now} onClick={() => openQuestion()}>
                                        {nextDueAt ? (nextDueAt <= now ? 'Continue practice' : 'Next review soon') : 'Try again'}
                                    </Button>
                                </div>
                            )}
                        </div>
                        <section aria-label="Question library" className={cn('min-w-0', selected && 'hidden lg:block')}>
                            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <p className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Question library</p>
                                    <h2 className="text-xl font-medium tracking-tight capitalize">{topicTitle}</h2>
                                    {scope.category.length > 1 && (
                                        <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{scope.category.slice(0, -1).join(' / ')}</p>
                                    )}
                                </div>
                                <span className="text-xs text-muted-foreground" aria-live="polite">
                                    {loading ? 'Loading…' : `${data?.total.toLocaleString() ?? 0} questions`}
                                </span>
                            </div>
                            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                                <div className="relative flex-1">
                                    <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
                                    <Input
                                        aria-label="Search questions"
                                        placeholder="Search questions or topics…"
                                        maxLength={200}
                                        value={scope.search}
                                        onChange={(event) => changeScope({ ...scope, search: event.target.value })}
                                        className="h-10 rounded-lg bg-card pr-9 pl-9"
                                    />
                                    {scope.search && (
                                        <button
                                            type="button"
                                            aria-label="Clear search"
                                            onClick={() => changeScope({ ...scope, search: '' })}
                                            className="absolute top-2 right-2 rounded p-1"
                                        >
                                            <X className="size-4" />
                                        </button>
                                    )}
                                </div>
                                <div role="group" className="flex shrink-0 gap-1 rounded-lg border bg-card p-1" aria-label="Practice status">
                                    {(
                                        [
                                            { value: 'all', label: 'All' },
                                            { value: 'new', label: 'Not added' },
                                            { value: 'approved', label: 'In practice' }
                                        ] as const
                                    ).map(({ value, label }) => (
                                        <button
                                            type="button"
                                            key={value}
                                            aria-pressed={scope.status === value}
                                            disabled={value !== 'all' && !approvals.ready}
                                            onClick={() => changeScope({ ...scope, status: value })}
                                            className={cn(
                                                'rounded-md px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                                                scope.status === value ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <p className="mb-4 text-xs text-muted-foreground">Random study follows the topic, search, and practice filters you choose here.</p>
                            {loading ? (
                                <div className="space-y-2" aria-label="Loading questions">
                                    {Array.from({ length: 6 }, (_, i) => (
                                        <Skeleton key={i} className="h-20 w-full rounded-xl" />
                                    ))}
                                </div>
                            ) : error ? (
                                <Card className="items-center gap-3 p-8 text-center">
                                    <CircleHelp className="size-6 text-muted-foreground" />
                                    <p role="alert" className="text-sm">
                                        {error}
                                    </p>
                                    <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                                        Try again
                                    </Button>
                                </Card>
                            ) : !data?.questions.length ? (
                                <Card className="items-center gap-3 p-10 text-center">
                                    <Search className="size-6 text-muted-foreground" />
                                    <h3 className="font-medium">No questions here yet</h3>
                                    <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                                        Try a different search or topic. Import a bank to begin. Questions enter agent practice after you reveal and rate them,
                                        when their next review is due.
                                    </p>
                                    <Button variant="outline" onClick={() => changeScope(initialScope)}>
                                        Clear filters
                                    </Button>
                                </Card>
                            ) : (
                                <div className="overflow-hidden rounded-xl border bg-card">
                                    <ul className="divide-y">
                                        {data.questions.map((question) => (
                                            <li key={question.id}>
                                                <button
                                                    type="button"
                                                    aria-disabled={busy || saving || !isDue(dueById.get(question.id) ?? question.dueAt, now)}
                                                    onClick={() => {
                                                        if (!busy && !saving && isDue(dueById.get(question.id) ?? question.dueAt, now))
                                                            void openQuestion(question.id)
                                                    }}
                                                    className="group/row flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-disabled:opacity-60 sm:px-5"
                                                >
                                                    <span
                                                        className={cn(
                                                            'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                                            approvedIds.has(question.id) ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                                                        )}
                                                    >
                                                        {approvedIds.has(question.id) ? <Check className="size-4" /> : <BookOpen className="size-4" />}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[13px] leading-5 font-medium">
                                                            <span className="sr-only">Study: </span>
                                                            {question.question.text}
                                                        </p>
                                                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{question.categories?.join(' / ')}</p>
                                                        <span className="text-[11px] text-muted-foreground">
                                                            {!isDue(dueById.get(question.id) ?? question.dueAt, now)
                                                                ? `Review ${new Date((dueById.get(question.id) ?? question.dueAt)!).toLocaleString()}`
                                                                : approvedIds.has(question.id)
                                                                  ? 'Ready to review'
                                                                  : 'New question'}
                                                        </span>
                                                    </div>
                                                    <Badge
                                                        variant="secondary"
                                                        className={cn(
                                                            'hidden rounded-md border-0 text-[10px] font-normal sm:inline-flex',
                                                            approvedIds.has(question.id) && 'bg-primary/10 text-primary'
                                                        )}
                                                    >
                                                        {approvedIds.has(question.id) ? 'In practice' : 'Not added'}
                                                    </Badge>
                                                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5" />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {data && data.total > data.pageSize && !loading && !error && (
                                <div className="mt-4 flex items-center justify-between">
                                    <p className="text-xs text-muted-foreground">
                                        Page {data.page} of {Math.ceil(data.total / data.pageSize)}
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={data.page <= 1}
                                            onClick={() => setPage(data.page - 1)}
                                            aria-label="Previous page"
                                        >
                                            <ChevronLeft className="size-4" />
                                            Previous
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={data.page * data.pageSize >= data.total}
                                            onClick={() => setPage(data.page + 1)}
                                            aria-label="Next page"
                                        >
                                            Next
                                            <ChevronRight className="size-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </section>
                    </div>
                </div>
                <footer className={cn('mt-12 border-t pt-5 text-center text-[11px] text-muted-foreground', selected && 'hidden lg:block')}>
                    A space to learn at your own pace. No scores. No rush.
                </footer>
            </main>
            <Dialog open={topicsOpen} onOpenChange={setTopicsOpen}>
                <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-md">
                    <DialogTitle>Choose a topic</DialogTitle>
                    <DialogDescription>Any category includes all of its subtopics.</DialogDescription>
                    {categoryTree}
                </DialogContent>
            </Dialog>
            <span className="sr-only" role="status">
                {busy ? 'Loading question' : ''}
            </span>
        </div>
    )
}
