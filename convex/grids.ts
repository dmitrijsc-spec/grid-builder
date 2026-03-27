import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'

const CHUNK_MARKER_PREFIX = 'chunked:v1:'
const CHUNK_MARKER_V2_PREFIX = 'chunked:v2:'

function parseChunkCountMarker(data: string): number | null {
  if (!data.startsWith(CHUNK_MARKER_PREFIX)) return null
  const rawCount = Number.parseInt(data.slice(CHUNK_MARKER_PREFIX.length), 10)
  if (!Number.isFinite(rawCount) || rawCount <= 0) return null
  return rawCount
}

function parseChunkMarkerV2(data: string): { uploadId: string; totalChunks: number } | null {
  if (!data.startsWith(CHUNK_MARKER_V2_PREFIX)) return null
  const rest = data.slice(CHUNK_MARKER_V2_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  const uploadId = rest.slice(0, sep)
  const totalRaw = Number.parseInt(rest.slice(sep + 1), 10)
  if (!uploadId || !Number.isFinite(totalRaw) || totalRaw <= 0) return null
  return { uploadId, totalChunks: totalRaw }
}

export const getProjects = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const rows = await ctx.db
      .query('gridProjects')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .collect()
    if (rows.length === 0) return rows

    return Promise.all(rows.map(async (row) => {
      const markerV2 = parseChunkMarkerV2(row.data)
      if (markerV2) {
        const parts: string[] = []
        for (let i = 0; i < markerV2.totalChunks; i += 1) {
          const chunk = await ctx.db
            .query('gridProjectChunks')
            .withIndex('by_user_upload_chunk', (q) =>
              q.eq('userId', userId).eq('uploadId', markerV2.uploadId).eq('chunkIndex', i))
            .first()
          if (!chunk) break
          parts.push(chunk.data)
        }
        const materialized = parts.join('')
        return { ...row, data: materialized || row.data }
      }

      const expectedCount = parseChunkCountMarker(row.data)
      if (!expectedCount) return row
      // Legacy v1 fallback: select chunk-by-index to avoid huge scans.
      const parts: string[] = []
      for (let i = 0; i < expectedCount; i += 1) {
        const chunk = await ctx.db
          .query('gridProjectChunks')
          .withIndex('by_user_chunk', (q) => q.eq('userId', userId).eq('chunkIndex', i))
          .first()
        if (!chunk) break
        parts.push(chunk.data)
      }
      const materialized = parts.join('')
      return { ...row, data: materialized || row.data }
    }))
  },
})

export const saveProjects = mutation({
  args: {
    data: v.string(),
  },
  handler: async (ctx, { data }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const existing = await ctx.db
      .query('gridProjects')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    const now = new Date().toISOString()

    if (existing) {
      await ctx.db.patch(existing._id, { data, updatedAt: now })
      return existing._id
    }
    return await ctx.db.insert('gridProjects', {
      userId,
      name: 'My Grids',
      data,
      updatedAt: now,
    })
  },
})

export const saveProjectsChunk = mutation({
  args: {
    uploadId: v.string(),
    chunkIndex: v.number(),
    totalChunks: v.number(),
    data: v.string(),
  },
  handler: async (ctx, { uploadId, chunkIndex, totalChunks, data }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    if (totalChunks <= 0) throw new Error('totalChunks must be > 0')
    if (chunkIndex < 0 || chunkIndex >= totalChunks) {
      throw new Error('chunkIndex out of range')
    }

    const existing = await ctx.db
      .query('gridProjects')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    const sameIndexChunk = await ctx.db
      .query('gridProjectChunks')
      .withIndex('by_user_upload_chunk', (q) =>
        q.eq('userId', userId).eq('uploadId', uploadId).eq('chunkIndex', chunkIndex))
      .first()
    if (sameIndexChunk) {
      await ctx.db.delete(sameIndexChunk._id)
    }

    const now = new Date().toISOString()
    await ctx.db.insert('gridProjectChunks', {
      userId,
      uploadId,
      chunkIndex,
      data,
      updatedAt: now,
    })

    if (chunkIndex === totalChunks - 1) {
      const marker = `${CHUNK_MARKER_V2_PREFIX}${uploadId}:${totalChunks}`
      if (existing) {
        await ctx.db.patch(existing._id, { data: marker, updatedAt: now })
        return existing._id
      }
      return await ctx.db.insert('gridProjects', {
        userId,
        name: 'My Grids',
        data: marker,
        updatedAt: now,
      })
    }

    return existing?._id ?? null
  },
})

const PUB_CHUNK_MARKER_PREFIX = 'pub-chunked:v1:'

function parsePubChunkMarker(data: string): { uploadId: string; totalChunks: number } | null {
  if (!data.startsWith(PUB_CHUNK_MARKER_PREFIX)) return null
  const rest = data.slice(PUB_CHUNK_MARKER_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  const uploadId = rest.slice(0, sep)
  const total = Number.parseInt(rest.slice(sep + 1), 10)
  if (!uploadId || !Number.isFinite(total) || total <= 0) return null
  return { uploadId, totalChunks: total }
}

export const getPublishedRuntimeGrid = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('publishedRuntimeGrid').order('desc').first()
    if (!row) return null
    const marker = parsePubChunkMarker(row.data)
    if (!marker) return { data: row.data, updatedAt: row.updatedAt }
    const parts: string[] = []
    for (let i = 0; i < marker.totalChunks; i += 1) {
      const chunk = await ctx.db
        .query('publishedRuntimeGridChunks')
        .withIndex('by_upload_chunk', (q) =>
          q.eq('uploadId', marker.uploadId).eq('chunkIndex', i))
        .first()
      if (!chunk) break
      parts.push(chunk.data)
    }
    return { data: parts.join('') || row.data, updatedAt: row.updatedAt }
  },
})

export const publishRuntimeGrid = mutation({
  args: { data: v.string() },
  handler: async (ctx, { data }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const now = new Date().toISOString()
    const existing = await ctx.db.query('publishedRuntimeGrid').order('desc').first()
    if (existing) {
      await ctx.db.patch(existing._id, { data, updatedAt: now })
    } else {
      await ctx.db.insert('publishedRuntimeGrid', { data, updatedAt: now })
    }
  },
})

export const publishRuntimeGridChunk = mutation({
  args: {
    uploadId: v.string(),
    chunkIndex: v.number(),
    totalChunks: v.number(),
    data: v.string(),
  },
  handler: async (ctx, { uploadId, chunkIndex, totalChunks, data }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    if (totalChunks <= 0) throw new Error('totalChunks must be > 0')
    if (chunkIndex < 0 || chunkIndex >= totalChunks) {
      throw new Error('chunkIndex out of range')
    }
    const now = new Date().toISOString()
    const existing = await ctx.db
      .query('publishedRuntimeGridChunks')
      .withIndex('by_upload_chunk', (q) =>
        q.eq('uploadId', uploadId).eq('chunkIndex', chunkIndex))
      .first()
    if (existing) {
      await ctx.db.delete(existing._id)
    }
    await ctx.db.insert('publishedRuntimeGridChunks', {
      uploadId,
      chunkIndex,
      data,
      updatedAt: now,
    })
    if (chunkIndex === totalChunks - 1) {
      const marker = `${PUB_CHUNK_MARKER_PREFIX}${uploadId}:${totalChunks}`
      const row = await ctx.db.query('publishedRuntimeGrid').order('desc').first()
      if (row) {
        await ctx.db.patch(row._id, { data: marker, updatedAt: now })
      } else {
        await ctx.db.insert('publishedRuntimeGrid', { data: marker, updatedAt: now })
      }
    }
  },
})
