import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { GridPackage } from '../components/grid/builder/types'

const PUB_DIRECT_MAX_BYTES = 900 * 1024
const PUB_CHUNK_CHAR_SIZE = 300_000

function splitToChunks(value: string, chunkSize: number): string[] {
  if (value.length <= chunkSize) return [value]
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize))
  }
  return chunks
}

function createUploadId(): string {
  return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function usePublishRuntimeGrid() {
  const publishDirect = useMutation(api.grids.publishRuntimeGrid)
  const publishChunk = useMutation(api.grids.publishRuntimeGridChunk)

  return async (desktopPkg: GridPackage | null, mobilePkg: GridPackage | null) => {
    const payload = JSON.stringify({ version: 1, desktopPkg, mobilePkg })
    const payloadBytes = new Blob([payload]).size
    if (payloadBytes <= PUB_DIRECT_MAX_BYTES) {
      await publishDirect({ data: payload })
    } else {
      const chunks = splitToChunks(payload, PUB_CHUNK_CHAR_SIZE)
      const uploadId = createUploadId()
      for (let i = 0; i < chunks.length; i += 1) {
        await publishChunk({
          uploadId,
          chunkIndex: i,
          totalChunks: chunks.length,
          data: chunks[i],
        })
      }
    }
  }
}
