/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARENT_ORIGIN?: string
  /** URL стрима (mp4 / HLS — в зависимости от плеера) для фона геймфрейма */
  readonly VITE_STREAM_URL?: string
  /** Статичная картинка-фон для теста (например /stream-test.jpg) */
  readonly VITE_STREAM_IMAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
