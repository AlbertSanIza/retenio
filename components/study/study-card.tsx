'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { reviewIntervals, type ReviewRating } from '@/lib/review-schedule'
import type { LibraryCard } from '@/lib/study'
import { ArrowLeft, Check, CheckCheck, Eye, ImageOff, LoaderCircle, Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

function StudyImage({ imageId, index, side, onZoom }: { imageId: string; index: number; side: string; onZoom: (id: string) => void }) {
    const [failed, setFailed] = useState(false)
    return (
        <div className="overflow-hidden rounded-xl border bg-white">
            {failed ? (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
                    <ImageOff className="size-4" />
                    This image could not load.
                    <Button variant="ghost" onClick={() => setFailed(false)}>
                        Retry
                    </Button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => onZoom(imageId)}
                    aria-label={`Enlarge ${side} image ${index + 1}`}
                    className="group/image relative block w-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {/* Original imported images retain their natural proportions. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={`/api/images/${imageId}`}
                        alt={`${side} illustration ${index + 1}`}
                        className="mx-auto max-h-[460px] w-auto max-w-full object-contain"
                        loading="lazy"
                        onError={() => setFailed(true)}
                    />
                    <span className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm">
                        <Maximize2 className="size-3" />
                        Enlarge
                    </span>
                </button>
            )}
        </div>
    )
}

export function StudyCard({
    card,
    approved,
    saving,
    canSave,
    error,
    onApproval,
    onRate,
    onClose,
    onReveal,
    busy
}: {
    card: LibraryCard
    approved: boolean
    saving: boolean
    canSave: boolean
    error: string | null
    busy: boolean
    onApproval: (approved: boolean) => void
    onRate: (rating: ReviewRating) => void
    onClose: () => void
    onReveal: () => void
}) {
    const [revealed, setRevealed] = useState(false)
    const [zoomed, setZoomed] = useState<string | null>(null)
    const headingRef = useRef<HTMLHeadingElement>(null)
    const answerRef = useRef<HTMLElement>(null)
    const errorRef = useRef<HTMLParagraphElement>(null)
    useEffect(() => {
        const target = revealed ? answerRef.current : headingRef.current
        target?.focus({ preventScroll: true })
    }, [revealed])
    useEffect(() => {
        if (!error) return
        errorRef.current?.focus({ preventScroll: true })
        errorRef.current?.scrollIntoView({ block: 'start' })
    }, [error])
    return (
        <Card className="overflow-hidden rounded-2xl border-border/80 py-0 shadow-[0_4px_28px_-18px_rgba(23,58,47,0.3)]" data-testid="study-card">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2 lg:items-start lg:px-7 lg:py-4">
                <div className="min-w-0 space-y-2">
                    <p className="hidden text-[10px] font-semibold tracking-[0.18em] text-primary uppercase lg:block">Your study space</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="line-clamp-2 text-right lg:hidden">{card.categories?.at(-1)}</span>
                        <span className="hidden lg:inline">{card.categories?.join(' / ')}</span>
                    </p>
                </div>
                <Button
                    variant="ghost"
                    aria-label="Back to library"
                    disabled={saving}
                    onClick={onClose}
                    className="order-first h-11 shrink-0 px-3 lg:order-none lg:w-11"
                >
                    <ArrowLeft className="size-4 lg:hidden" />
                    <span className="lg:hidden">Library</span>
                    <X className="hidden size-4 lg:block" />
                </Button>
            </CardHeader>
            <CardContent className="space-y-6 px-5 py-6 sm:px-7 sm:py-7">
                {approved && (
                    <div>
                        <Badge className="gap-1 rounded-md bg-primary/10 text-primary">
                            <Check className="size-3" />
                            In agent practice
                        </Badge>
                        <Button variant="ghost" size="sm" disabled={!canSave || saving || busy} onClick={() => onApproval(false)} className="ml-2 text-xs">
                            Remove from agent practice
                        </Button>
                    </div>
                )}
                <h2 ref={headingRef} tabIndex={-1} className="max-w-3xl text-xl leading-relaxed font-medium tracking-tight whitespace-pre-wrap sm:text-2xl">
                    {card.question.text}
                </h2>
                {card.question.imageIds?.map((id, index) => (
                    <StudyImage key={id} imageId={id} index={index} side="Question" onZoom={setZoomed} />
                ))}
                {revealed && (
                    <section ref={answerRef} tabIndex={-1} aria-label="Answer" className="animate-in space-y-5 duration-200 fade-in">
                        <div className="rounded-xl border border-primary/10 bg-primary/[0.04] p-5">
                            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-primary uppercase">
                                <CheckCheck className="size-4" />
                                Answer
                            </p>
                            <p className="text-base leading-7 whitespace-pre-wrap">{card.answer.text}</p>
                        </div>
                        {card.answer.imageIds?.map((id, index) => (
                            <StudyImage key={id} imageId={id} index={index} side="Answer" onZoom={setZoomed} />
                        ))}
                    </section>
                )}
                {error && (
                    <p ref={errorRef} tabIndex={-1} role="alert" className="scroll-mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </p>
                )}
                <div
                    data-testid="study-actions"
                    className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:static lg:space-y-3 lg:bg-transparent lg:px-0 lg:pt-5 lg:pb-0 lg:backdrop-blur-none"
                >
                    {revealed ? (
                        <div className="grid grid-cols-4 gap-2" aria-label="Choose your next review" role="group">
                            {(Object.entries(reviewIntervals) as [ReviewRating, (typeof reviewIntervals)[ReviewRating]][]).map(([rating, option]) => (
                                <Button
                                    key={rating}
                                    variant="outline"
                                    disabled={!canSave || saving || busy}
                                    onClick={() => onRate(rating)}
                                    aria-label={`${option.label}, review in ${option.interval}`}
                                    className={`h-16 min-w-0 flex-col gap-1 px-1 text-sm ${rating === 'again' ? 'border-rose-200 bg-rose-50 text-rose-800' : rating === 'hard' ? 'border-amber-200 bg-amber-50 text-amber-900' : rating === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}
                                >
                                    <span className="text-[11px] font-normal">{option.interval}</span>
                                    <span>{option.label}</span>
                                </Button>
                            ))}
                        </div>
                    ) : (
                        <Button
                            size="lg"
                            disabled={busy || saving}
                            onClick={() => {
                                setRevealed(true)
                                onReveal()
                            }}
                            className="h-12 w-full"
                        >
                            <Eye className="size-4" />
                            Reveal answer
                        </Button>
                    )}
                    <p role="status" className="text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
                        {saving ? (
                            <span className="inline-flex items-center gap-2">
                                <LoaderCircle className="size-3 animate-spin" />
                                Saving your review…
                            </span>
                        ) : !canSave ? (
                            'Practice is not connected yet. Reconnect to save your review.'
                        ) : revealed ? (
                            'Your rating saves this question for practice when it is due.'
                        ) : (
                            'Think it through, then reveal. No rush.'
                        )}
                    </p>
                </div>
            </CardContent>
            <Dialog
                open={!!zoomed}
                onOpenChange={(open) => {
                    if (!open) setZoomed(null)
                }}
            >
                <DialogContent className="max-h-[92dvh] overflow-auto sm:max-w-[min(1100px,94vw)]">
                    <DialogTitle>Study illustration</DialogTitle>
                    <DialogDescription>Original image for this question.</DialogDescription>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {zoomed && <img src={`/api/images/${zoomed}`} alt="Enlarged study illustration" className="mx-auto h-auto max-w-full" />}
                </DialogContent>
            </Dialog>
        </Card>
    )
}
