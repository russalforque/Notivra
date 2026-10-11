import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { db } from '../db/database'
import { setOwnerId } from '../db/session'
import { setFileStore } from '../services/storage/fileStore'

beforeEach(async () => {
  await db.delete()
  await db.open()
  setOwnerId(null)
  setFileStore(null)
})

afterEach(() => {
  cleanup()
})
