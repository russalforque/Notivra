import { describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { ValidationError } from '../../lib/errors'
import { addItem, completeSession, createStudySet, createStudySetWithItems, deleteStudySet, listItems, recordAnswer, startSession } from './studyService'

describe('study service', () => {
  it('validates items by kind', async () => {
    const set = await createStudySet({ title: 'Bio' })
    await expect(addItem(set.id, { kind: 'multiple_choice', prompt: 'Q', answer: 'X', choices: ['A', 'B'] })).rejects.toBeInstanceOf(ValidationError)
    await expect(addItem(set.id, { kind: 'true_false', prompt: 'Q', answer: 'yes' })).rejects.toBeInstanceOf(ValidationError)
    await expect(addItem(set.id, { kind: 'flashcard', prompt: '  ', answer: 'x' })).rejects.toBeInstanceOf(ValidationError)
    const ok = await addItem(set.id, { kind: 'multiple_choice', prompt: 'Q', answer: 'B', choices: ['A', 'B', 'C'] })
    expect(ok.srs.reps).toBe(0)
  })

  it('creates a set with items atomically, in order', async () => {
    const set = await createStudySetWithItems({ title: 'Cells', origin: 'ai' }, [
      { kind: 'flashcard', prompt: 'ATP?', answer: 'Energy currency' },
      { kind: 'true_false', prompt: 'Cells have nuclei', answer: 'false' },
    ])
    const items = await listItems(set.id)
    expect(items.map((i) => i.prompt)).toEqual(['ATP?', 'Cells have nuclei'])
  })

  it('rolls back the whole set when one item is invalid', async () => {
    await expect(
      createStudySetWithItems({ title: 'Broken' }, [
        { kind: 'flashcard', prompt: 'ok', answer: 'ok' },
        { kind: 'multiple_choice', prompt: 'bad', answer: 'z', choices: ['a'] },
      ]),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await db.studySets.count()).toBe(0)
    expect(await db.studyItems.count()).toBe(0)
  })

  it('records answers idempotently and updates the review schedule', async () => {
    const set = await createStudySet({ title: 'Deck' })
    const item = await addItem(set.id, { kind: 'flashcard', prompt: 'a', answer: 'b' })
    const session = await startSession(set.id, 'flashcards', 1)
    await recordAnswer(session.id, { itemId: item.id, correct: false, grade: 'again', response: null, at: Date.now() })
    const s2 = await recordAnswer(session.id, { itemId: item.id, correct: true, grade: 'good', response: null, at: Date.now() })
    expect(s2.answers).toHaveLength(1)
    expect(s2.correctCount).toBe(1)
    expect((await db.studyItems.get(item.id))?.srs.lapses).toBe(1)
    const done = await completeSession(session.id)
    const again = await completeSession(session.id)
    expect(again.completedAt).toBe(done.completedAt)
  })

  it('refuses to start empty sessions and deletes sets with their items', async () => {
    const set = await createStudySet({ title: 'Empty' })
    await expect(startSession(set.id, 'quiz', 0)).rejects.toBeInstanceOf(ValidationError)
    await addItem(set.id, { kind: 'flashcard', prompt: 'a', answer: 'b' })
    await deleteStudySet(set.id)
    expect(await listItems(set.id)).toHaveLength(0)
    expect((await db.studySets.get(set.id))?.deletedAt).not.toBeNull()
  })
})
