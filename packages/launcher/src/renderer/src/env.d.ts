/// <reference types="vite/client" />

import type { YufaApi } from '@yufa/shared'

declare global {
  interface Window {
    yufa: YufaApi
  }
}

export {}
