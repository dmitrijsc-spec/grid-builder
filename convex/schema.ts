import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,
  gridProjects: defineTable({
    userId: v.id('users'),
    name: v.string(),
    // LZ-string compressed JSON of GridProjectsState or chunk marker.
    data: v.string(),
    updatedAt: v.string(),
  }).index('by_user', ['userId']),
  gridProjectChunks: defineTable({
    userId: v.id('users'),
    uploadId: v.optional(v.string()),
    chunkIndex: v.number(),
    data: v.string(),
    updatedAt: v.string(),
  })
    .index('by_user', ['userId'])
    .index('by_user_chunk', ['userId', 'chunkIndex'])
    .index('by_user_upload', ['userId', 'uploadId'])
    .index('by_user_upload_chunk', ['userId', 'uploadId', 'chunkIndex']),
  publishedRuntimeGrid: defineTable({
    data: v.string(),
    updatedAt: v.string(),
  }),
  publishedRuntimeGridChunks: defineTable({
    uploadId: v.string(),
    chunkIndex: v.number(),
    data: v.string(),
    updatedAt: v.string(),
  })
    .index('by_upload_chunk', ['uploadId', 'chunkIndex']),
})
