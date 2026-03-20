import { describe, expect, it } from 'vitest'
import { defaultEntryDraft } from './defaults'
import type { PreviewImage, VaultEntry } from './types'
import {
  escapeHtml,
  formatCompactDate,
  formatDate,
  getRelationshipLabel,
  normalizeDraft,
  parseTags,
  renderInlineMarkdown,
  renderMarkdown,
  syncPreviewPath,
  toEntryInput,
  toInlineDraft,
  withPreviewOrdering
} from './utils'

// ─── Helpers ───

function makePreviewImage(overrides: Partial<PreviewImage> = {}): PreviewImage {
  return {
    id: 'img-1',
    path: '/images/preview.png',
    order: 0,
    createdAt: '2025-01-01T00:00:00Z',
    isMissing: false,
    ...overrides
  }
}

function makeVaultEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: 'entry-1',
    title: 'Test Entry',
    description: 'A test entry',
    type: 'snippet',
    tags: ['react', 'typescript'],
    stack: 'React',
    rootPath: '/projects/test',
    entryFilePath: '/projects/test/index.ts',
    previewImagePath: '/images/preview.png',
    previewImages: [makePreviewImage()],
    isFavorite: true,
    isPinned: false,
    isTemplate: false,
    notes: 'Some notes',
    goodFor: 'Testing',
    setupNotes: 'npm install',
    dependencyNotes: 'node 18+',
    runCommand: 'npm run dev',
    status: 'polished',
    hasBrokenPaths: false,
    lastViewedAt: '2025-06-01T12:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    ...overrides
  }
}

// ─── withPreviewOrdering ───

describe('withPreviewOrdering', () => {
  it('assigns sequential order indices', () => {
    const images = [
      makePreviewImage({ id: 'a', order: 99 }),
      makePreviewImage({ id: 'b', order: 99 }),
      makePreviewImage({ id: 'c', order: 99 })
    ]
    const result = withPreviewOrdering(images)
    expect(result.map((img) => img.order)).toEqual([0, 1, 2])
  })

  it('keeps isMissing false when path exists but isMissing is false', () => {
    const images = [makePreviewImage({ path: '/a.png', isMissing: false })]
    const result = withPreviewOrdering(images)
    expect(result[0].isMissing).toBe(false)
  })

  it('preserves isMissing true when path exists and isMissing is true', () => {
    const images = [makePreviewImage({ path: '/a.png', isMissing: true })]
    const result = withPreviewOrdering(images)
    expect(result[0].isMissing).toBe(true)
  })

  it('sets isMissing false when path is empty', () => {
    const images = [makePreviewImage({ path: '', isMissing: true })]
    const result = withPreviewOrdering(images)
    expect(result[0].isMissing).toBe(false)
  })

  it('returns empty array for empty input', () => {
    expect(withPreviewOrdering([])).toEqual([])
  })
})

// ─── syncPreviewPath ───

describe('syncPreviewPath', () => {
  it('sets previewImagePath from first image', () => {
    const value = {
      previewImages: [
        makePreviewImage({ id: 'a', path: '/first.png' }),
        makePreviewImage({ id: 'b', path: '/second.png' })
      ],
      previewImagePath: '/old.png'
    }
    const result = syncPreviewPath(value)
    expect(result.previewImagePath).toBe('/first.png')
  })

  it('sets previewImagePath to empty string when no images', () => {
    const value = { previewImages: [], previewImagePath: '/old.png' }
    const result = syncPreviewPath(value)
    expect(result.previewImagePath).toBe('')
  })

  it('reorders preview images', () => {
    const value = {
      previewImages: [
        makePreviewImage({ id: 'a', order: 5 }),
        makePreviewImage({ id: 'b', order: 3 })
      ],
      previewImagePath: ''
    }
    const result = syncPreviewPath(value)
    expect(result.previewImages[0].order).toBe(0)
    expect(result.previewImages[1].order).toBe(1)
  })
})

// ─── normalizeDraft ───

describe('normalizeDraft', () => {
  it('returns default draft for null', () => {
    expect(normalizeDraft(null)).toEqual(defaultEntryDraft)
  })

  it('returns default draft for undefined', () => {
    expect(normalizeDraft(undefined)).toEqual(defaultEntryDraft)
  })

  it('extracts draft fields from a vault entry', () => {
    const entry = makeVaultEntry()
    const draft = normalizeDraft(entry)
    expect(draft.title).toBe('Test Entry')
    expect(draft.status).toBe('polished')
    expect(draft.isFavorite).toBe(true)
    expect(draft.runCommand).toBe('npm run dev')
  })

  it('does not include id, createdAt, updatedAt, hasBrokenPaths', () => {
    const entry = makeVaultEntry()
    const draft = normalizeDraft(entry)
    expect('id' in draft).toBe(false)
    expect('createdAt' in draft).toBe(false)
    expect('updatedAt' in draft).toBe(false)
    expect('hasBrokenPaths' in draft).toBe(false)
  })
})

// ─── toEntryInput ───

describe('toEntryInput', () => {
  it('produces VaultEntryInput from a vault entry', () => {
    const entry = makeVaultEntry()
    const input = toEntryInput(entry)
    expect(input.title).toBe('Test Entry')
    expect(input.previewImages[0].order).toBe(0)
  })

  it('sets previewImagePath from first reordered image', () => {
    const entry = makeVaultEntry({
      previewImages: [
        makePreviewImage({ id: 'a', path: '/first.png' }),
        makePreviewImage({ id: 'b', path: '/second.png' })
      ]
    })
    const input = toEntryInput(entry)
    expect(input.previewImagePath).toBe('/first.png')
  })

  it('sets empty previewImagePath when no images', () => {
    const entry = makeVaultEntry({ previewImages: [], previewImagePath: '' })
    const input = toEntryInput(entry)
    expect(input.previewImagePath).toBe('')
  })
})

// ─── toInlineDraft ───

describe('toInlineDraft', () => {
  it('returns default values for null', () => {
    const draft = toInlineDraft(null)
    expect(draft.title).toBe('')
    expect(draft.status).toBe('draft')
    expect(draft.tags).toEqual([])
  })

  it('extracts inline-editable fields from entry', () => {
    const entry = makeVaultEntry()
    const draft = toInlineDraft(entry)
    expect(draft.title).toBe('Test Entry')
    expect(draft.description).toBe('A test entry')
    expect(draft.tags).toEqual(['react', 'typescript'])
    expect(draft.stack).toBe('React')
    expect(draft.status).toBe('polished')
    expect(draft.notes).toBe('Some notes')
    expect(draft.goodFor).toBe('Testing')
    expect(draft.setupNotes).toBe('npm install')
    expect(draft.dependencyNotes).toBe('node 18+')
  })
})

// ─── parseTags ───

describe('parseTags', () => {
  it('splits comma-separated tags', () => {
    expect(parseTags('react, vue, svelte')).toEqual(['react', 'vue', 'svelte'])
  })

  it('trims whitespace', () => {
    expect(parseTags('  react ,  vue  ')).toEqual(['react', 'vue'])
  })

  it('filters empty strings', () => {
    expect(parseTags('react,,vue,')).toEqual(['react', 'vue'])
  })

  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([])
  })

  it('returns empty array for only commas', () => {
    expect(parseTags(',,,,')).toEqual([])
  })

  it('handles single tag', () => {
    expect(parseTags('react')).toEqual(['react'])
  })
})

// ─── getRelationshipLabel ───

describe('getRelationshipLabel', () => {
  it('replaces hyphens with spaces', () => {
    expect(getRelationshipLabel('used-in')).toBe('used in')
    expect(getRelationshipLabel('derived-from')).toBe('derived from')
    expect(getRelationshipLabel('pairs-well-with')).toBe('pairs well with')
  })

  it('handles single-word type', () => {
    // variant-of has one hyphen
    expect(getRelationshipLabel('variant-of')).toBe('variant of')
  })
})

// ─── formatDate ───

describe('formatDate', () => {
  it('returns "Never" for empty string', () => {
    expect(formatDate('')).toBe('Never')
  })

  it('formats a valid date string', () => {
    const result = formatDate('2025-06-15T10:30:00Z')
    // Just check it produced a non-empty string (locale-dependent)
    expect(result).toBeTruthy()
    expect(result).not.toBe('Never')
  })
})

// ─── formatCompactDate ───

describe('formatCompactDate', () => {
  it('returns "Never" for empty string', () => {
    expect(formatCompactDate('')).toBe('Never')
  })

  it('formats a valid date string without time', () => {
    const result = formatCompactDate('2025-06-15T10:30:00Z')
    expect(result).toBeTruthy()
    expect(result).not.toBe('Never')
  })
})

// ─── escapeHtml ───

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
  })

  it('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;')
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

// ─── renderInlineMarkdown ───

describe('renderInlineMarkdown', () => {
  it('renders inline code', () => {
    expect(renderInlineMarkdown('use `npm install`')).toBe('use <code>npm install</code>')
  })

  it('renders bold text', () => {
    expect(renderInlineMarkdown('this is **bold**')).toBe('this is <strong>bold</strong>')
  })

  it('renders italic text', () => {
    expect(renderInlineMarkdown('this is *italic*')).toBe('this is <em>italic</em>')
  })

  it('renders mixed inline formatting', () => {
    expect(renderInlineMarkdown('**bold** and `code`')).toBe(
      '<strong>bold</strong> and <code>code</code>'
    )
  })

  it('leaves plain text unchanged', () => {
    expect(renderInlineMarkdown('hello world')).toBe('hello world')
  })
})

// ─── renderMarkdown ───

describe('renderMarkdown', () => {
  it('renders paragraphs', () => {
    expect(renderMarkdown('Hello world')).toBe('<p>Hello world</p>')
  })

  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toBe('<h4>Title</h4>')
    expect(renderMarkdown('## Subtitle')).toBe('<h5>Subtitle</h5>')
  })

  it('renders unordered lists with dash', () => {
    const md = '- item one\n- item two'
    expect(renderMarkdown(md)).toBe('<ul><li>item one</li><li>item two</li></ul>')
  })

  it('renders unordered lists with asterisk', () => {
    const md = '* item one\n* item two'
    expect(renderMarkdown(md)).toBe('<ul><li>item one</li><li>item two</li></ul>')
  })

  it('renders code blocks', () => {
    const md = '```\nconst x = 1\n```'
    expect(renderMarkdown(md)).toBe('<pre><code>const x = 1\n</code></pre>')
  })

  it('escapes html inside content', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    )
  })

  it('renders inline formatting within paragraphs', () => {
    expect(renderMarkdown('this is **bold**')).toBe('<p>this is <strong>bold</strong></p>')
  })

  it('separates paragraphs on blank lines', () => {
    const md = 'First paragraph\n\nSecond paragraph'
    expect(renderMarkdown(md)).toBe('<p>First paragraph</p><p>Second paragraph</p>')
  })

  it('handles empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('closes unclosed code blocks', () => {
    const md = '```\ncode here'
    expect(renderMarkdown(md)).toBe('<pre><code>code here\n</code></pre>')
  })
})
