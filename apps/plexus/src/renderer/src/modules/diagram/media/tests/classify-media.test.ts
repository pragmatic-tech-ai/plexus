import { describe, it, expect } from 'vitest'
import { MediaKind } from '../media-kind'
import { classifyFile, classifyUri, isImageExtension } from '../classify-media'

describe('classifyFile', () => {
    it('treats image/* MIME as Image', () => {
        expect(classifyFile({ name: 'a.png', type: 'image/png' })).toBe(MediaKind.Image)
    })
    it('falls back to extension when MIME is empty', () => {
        expect(classifyFile({ name: 'a.WEBP', type: '' })).toBe(MediaKind.Image)
    })
    it('treats non-image files as FileLink', () => {
        expect(classifyFile({ name: 'report.pdf', type: 'application/pdf' })).toBe(MediaKind.FileLink)
    })
})

describe('classifyUri', () => {
    it('treats http(s) as Hyperlink', () => {
        expect(classifyUri('https://example.com/page')).toBe(MediaKind.Hyperlink)
    })
    it('treats a direct image URL as Image', () => {
        expect(classifyUri('https://cdn.example.com/pic.jpg')).toBe(MediaKind.Image)
    })
    it('treats a file:// URI as FileLink', () => {
        expect(classifyUri('file:///C:/docs/x.docx')).toBe(MediaKind.FileLink)
    })
})

describe('isImageExtension', () => {
    it('accepts common raster + svg', () => {
        expect(isImageExtension('x.svg')).toBe(true)
        expect(isImageExtension('x.txt')).toBe(false)
    })
})
