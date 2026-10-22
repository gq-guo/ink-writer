import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

// jsdom 不实现这些 API，但 CM6 / 组件会用到
if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

if (!('ResizeObserver' in window)) {
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom 未实现 Range.getClientRects / getBoundingClientRect，
// CM6 的 measure 阶段会用到，这里补一个空实现避免噪声报错
if (typeof Range !== 'undefined') {
  const emptyRect = () =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    }) as DOMRect

  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function () {
      return {
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      } as unknown as DOMRectList
    }
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = emptyRect
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})
