import { defaultEntryDraft } from './defaults'
import type {
  EntryDraft,
  ImportCandidate,
  PreviewImage,
  RelationshipType,
  VaultEntry,
  VaultEntryInput
} from './types'

export type InlineDraft = {
  title: string
  description: string
  tags: string[]
  stack: string
  status: EntryDraft['status']
  notes: string
  goodFor: string
  setupNotes: string
  dependencyNotes: string
}

export function withPreviewOrdering(images: PreviewImage[]): PreviewImage[] {
  return images.map((image, index) => ({
    ...image,
    order: index,
    isMissing: Boolean(image.path) && Boolean(image.isMissing)
  }))
}

export function syncPreviewPath<T extends { previewImages: PreviewImage[]; previewImagePath: string }>(
  value: T
): T {
  const previewImages = withPreviewOrdering(value.previewImages)
  return {
    ...value,
    previewImages,
    previewImagePath: previewImages[0]?.path ?? ''
  }
}

export function normalizeDraft(entry?: VaultEntry | null): EntryDraft {
  if (!entry) {
    return defaultEntryDraft
  }

  return {
    title: entry.title,
    description: entry.description,
    type: entry.type,
    tags: entry.tags,
    stack: entry.stack,
    rootPath: entry.rootPath,
    entryFilePath: entry.entryFilePath,
    previewImagePath: entry.previewImagePath,
    previewImages: entry.previewImages,
    isFavorite: entry.isFavorite,
    isPinned: entry.isPinned,
    isTemplate: entry.isTemplate,
    notes: entry.notes,
    goodFor: entry.goodFor,
    setupNotes: entry.setupNotes,
    dependencyNotes: entry.dependencyNotes,
    runCommand: entry.runCommand,
    status: entry.status
  }
}

export function toEntryInput(entry: EntryDraft | VaultEntry | ImportCandidate): VaultEntryInput {
  const previewImages = withPreviewOrdering(entry.previewImages)

  return {
    title: entry.title,
    description: entry.description,
    type: entry.type,
    tags: entry.tags,
    stack: entry.stack,
    rootPath: entry.rootPath,
    entryFilePath: entry.entryFilePath,
    previewImagePath: previewImages[0]?.path ?? entry.previewImagePath ?? '',
    previewImages,
    isFavorite: entry.isFavorite,
    isPinned: entry.isPinned,
    isTemplate: entry.isTemplate,
    notes: entry.notes,
    goodFor: entry.goodFor,
    setupNotes: entry.setupNotes,
    dependencyNotes: entry.dependencyNotes,
    runCommand: entry.runCommand,
    status: entry.status
  }
}

export function toInlineDraft(entry: VaultEntry | null): InlineDraft {
  return {
    title: entry?.title ?? '',
    description: entry?.description ?? '',
    tags: entry?.tags ?? [],
    stack: entry?.stack ?? '',
    status: entry?.status ?? 'draft',
    notes: entry?.notes ?? '',
    goodFor: entry?.goodFor ?? '',
    setupNotes: entry?.setupNotes ?? '',
    dependencyNotes: entry?.dependencyNotes ?? ''
  }
}

export function formatDate(value: string): string {
  if (!value) {
    return 'Never'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function formatCompactDate(value: string): string {
  if (!value) {
    return 'Never'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium'
  }).format(new Date(value))
}

export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function getRelationshipLabel(value: RelationshipType): string {
  return value.replaceAll('-', ' ')
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

export function renderMarkdown(value: string): string {
  const escaped = escapeHtml(value)
  const lines = escaped.split('\n')
  const output: string[] = []
  let inList = false
  let inCode = false
  let paragraph: string[] = []

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      output.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }

  function closeList(): void {
    if (inList) {
      output.push('</ul>')
      inList = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.startsWith('```')) {
      flushParagraph()
      closeList()
      if (inCode) {
        output.push('</code></pre>')
        inCode = false
      } else {
        output.push('<pre><code>')
        inCode = true
      }
      continue
    }

    if (inCode) {
      output.push(`${line}\n`)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      closeList()
      continue
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph()
      closeList()
      output.push(`<h4>${renderInlineMarkdown(trimmed.slice(2))}</h4>`)
      continue
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph()
      closeList()
      output.push(`<h5>${renderInlineMarkdown(trimmed.slice(3))}</h5>`)
      continue
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph()
      if (!inList) {
        output.push('<ul>')
        inList = true
      }
      output.push(`<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`)
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  closeList()

  if (inCode) {
    output.push('</code></pre>')
  }

  return output.join('')
}
