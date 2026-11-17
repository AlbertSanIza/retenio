'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/convex/_generated/api'
import type { ImportPlan, ImportProgress } from '@/lib/bank-types'
import { bankKey } from '@/lib/import/upload'
import { useConvex, useQuery } from 'convex/react'
import { LoaderCircle, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function UploadBank() {
    const client = useConvex()
    const banks = useQuery(api.library.collections) ?? []
    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [plan, setPlan] = useState<ImportPlan | null>(null)
    const [name, setName] = useState('')
    const [target, setTarget] = useState('new')
    const [phase, setPhase] = useState<'idle' | 'reading' | 'ready' | 'uploading' | 'done'>('idle')
    const [progress, setProgress] = useState<ImportProgress | null>(null)
    const [error, setError] = useState('')
    const [result, setResult] = useState('')
    const worker = useRef<Worker | null>(null)
    const active = phase === 'reading' || phase === 'uploading'
    useEffect(
        () => () => {
            worker.current?.terminate()
        },
        []
    )
    useEffect(() => {
        if (!active) return
        const prevent = (event: BeforeUnloadEvent) => {
            event.preventDefault()
        }
        window.addEventListener('beforeunload', prevent)
        return () => window.removeEventListener('beforeunload', prevent)
    }, [active])
    function read(file: File) {
        worker.current?.terminate()
        setFile(file)
        setPlan(null)
        setError('')
        setResult('')
        setPhase('reading')
        setProgress({ message: 'Opening your Anki package', completed: 0, total: 1 })
        const parser = new Worker(new URL('../../lib/import/import.worker.ts', import.meta.url), { type: 'module' })
        worker.current = parser
        parser.onmessage = ({ data }) => {
            if (worker.current !== parser) return
            if (data.type === 'progress') setProgress(data.progress)
            else if (data.type === 'ready') {
                setPlan(data.plan)
                setName(data.plan.suggestedName)
                setTarget(banks.some((b) => b.key === bankKey(data.plan.suggestedName)) ? bankKey(data.plan.suggestedName) : 'new')
                setPhase('ready')
                parser.terminate()
                worker.current = null
            } else if (data.type === 'error') {
                setError(data.message)
                setPhase('idle')
                parser.terminate()
                worker.current = null
            }
        }
        parser.onerror = () => {
            setError('Could not open this package. Try a compatible Anki export.')
            setPhase('idle')
            parser.terminate()
            worker.current = null
        }
        parser.postMessage({ file, origin: window.location.origin })
    }
    function upload() {
        if (!file || !plan) return
        setPhase('uploading')
        setError('')
        const selected = banks.find((b) => b.key === target)
        const uploader = new Worker(new URL('../../lib/import/upload.worker.ts', import.meta.url), { type: 'module' })
        worker.current = uploader
        uploader.onmessage = ({ data }) => {
            if (worker.current !== uploader) return
            if (data.type === 'progress') setProgress(data.progress)
            else {
                if (data.type === 'done') {
                    setResult(
                        data.result.unchanged
                            ? 'This bank is already up to date. Your review schedule is unchanged.'
                            : `${data.result.count.toLocaleString()} questions are ready to study.`
                    )
                    setPhase('done')
                    setPlan(null)
                    setFile(null)
                } else {
                    setError(data.message)
                    setPhase('ready')
                }
                uploader.terminate()
                worker.current = null
            }
        }
        uploader.onerror = () => {
            setError('Import interrupted. Please retry; completed images will be reused.')
            setPhase('ready')
            uploader.terminate()
            worker.current = null
        }
        uploader.postMessage({ type: 'upload', file, plan, key: selected?.key ?? bankKey(name), name: selected?.name ?? name.trim(), url: client.url })
    }
    function cancel() {
        if (phase === 'reading') {
            worker.current?.terminate()
            worker.current = null
            setPhase('idle')
            setProgress(null)
        } else worker.current?.postMessage({ type: 'cancel' })
    }
    const conflictingName = target === 'new' && banks.some((b) => b.key === bankKey(name))
    return (
        <>
            <Button variant="outline" className="h-11" onClick={() => setOpen(true)}>
                <Upload className="size-4" />
                <span>Import bank</span>
            </Button>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!active) setOpen(next)
                }}
            >
                <DialogContent showCloseButton={!active} className="max-h-[90dvh] overflow-auto sm:max-w-lg">
                    <DialogTitle>A new bank to explore</DialogTitle>
                    <DialogDescription>
                        Import an Anki .apkg file. Questions and images live in your shared library; re-importing keeps your review schedule.
                    </DialogDescription>
                    <div className="space-y-5">
                        <label className="block space-y-2 text-sm font-medium">
                            Anki package
                            <Input
                                type="file"
                                accept=".apkg"
                                disabled={active}
                                onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    e.target.value = ''
                                    if (file) read(file)
                                }}
                                className="h-auto py-3"
                            />
                        </label>
                        <p className="text-xs leading-5 text-muted-foreground">
                            Up to 512 MB. In Anki’s export options, enable “Support older Anki versions”. Text, cloze questions, and JPG, PNG, GIF or WebP
                            images are supported. Audio and custom interactive templates are not supported.
                        </p>
                        {plan && (
                            <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                                <p className="text-sm">
                                    {plan.cards.length.toLocaleString()} questions · {plan.images.length.toLocaleString()} images ·{' '}
                                    {(plan.imageBytes / 1048576).toFixed(1)} MB
                                </p>
                                <label className="block space-y-2 text-sm">
                                    Import into
                                    <select
                                        aria-label="Import into"
                                        className="h-11 w-full rounded-md border bg-background px-3"
                                        value={target}
                                        disabled={active}
                                        onChange={(e) => setTarget(e.target.value)}
                                    >
                                        <option value="new">A new bank</option>
                                        {banks.map((bank) => (
                                            <option key={bank.key} value={bank.key}>
                                                {bank.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {target === 'new' && (
                                    <label className="block space-y-2 text-sm">
                                        Bank name
                                        <Input value={name} maxLength={100} disabled={active} onChange={(e) => setName(e.target.value)} />
                                    </label>
                                )}
                                {conflictingName && <p className="text-xs text-destructive">That name already exists. Select its bank above to update it.</p>}
                                <p className="text-xs leading-5 text-muted-foreground">
                                    Matching questions are updated. Existing questions and review dates are kept. Your bank changes only after the whole import
                                    finishes.
                                </p>
                            </div>
                        )}
                        {active && progress && (
                            <div role="status" className="space-y-2">
                                <p className="flex items-center gap-2 text-sm">
                                    <LoaderCircle className="size-4 animate-spin" />
                                    {progress.message}
                                </p>
                                <progress
                                    aria-label="Import progress"
                                    className="h-2 w-full accent-primary"
                                    value={progress.completed}
                                    max={Math.max(1, progress.total)}
                                />
                                <p className="text-xs text-muted-foreground">Keep this page open until the import finishes.</p>
                            </div>
                        )}
                        {error && (
                            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                                {error}
                            </p>
                        )}
                        {result && (
                            <p role="status" className="rounded-lg bg-primary/10 p-4 text-sm text-primary">
                                {result}
                            </p>
                        )}
                        <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 flex justify-end gap-2 border-t bg-popover p-4">
                            {active ? (
                                <Button variant="outline" onClick={cancel}>
                                    Cancel import
                                </Button>
                            ) : (
                                <Button variant="outline" onClick={() => setOpen(false)}>
                                    {phase === 'done' ? 'Done' : 'Close'}
                                </Button>
                            )}
                            {plan && !active && (
                                <Button onClick={upload} disabled={(target === 'new' && !bankKey(name)) || conflictingName}>
                                    Import questions
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
