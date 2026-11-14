import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import BookingForm from '../src/components/BookingForm.jsx'
import { MEETING_TYPES } from '../src/config.js'

afterEach(cleanup)

const intro30      = MEETING_TYPES.find(mt => mt.id === 'intro_30')
const diagnostic60 = MEETING_TYPES.find(mt => mt.id === 'diagnostic_60')

const baseForm = {
  name: '', email: '', phone: '', subject: '', focus: '',
  locationMode: 'virtual', meetingLocation: '',
}

// 2026-11-20 is a Friday (IST), 2026-11-19 a Thursday — both inside the
// owner booking windows, so only the clinic rule differs between them.
const FRIDAY_10 = { start: '2026-11-20T10:00:00+02:00' }
const THURSDAY_1830 = { start: '2026-11-19T18:30:00+02:00' }

function renderForm(meetingType, selectedSlot, onChange = vi.fn(), formData = {}) {
  return {
    onChange,
    ...render(
      <BookingForm
        selectedSlot={selectedSlot}
        meetingType={meetingType}
        userTz="Asia/Jerusalem"
        formData={{ ...baseForm, ...formData }}
        onChange={onChange}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
        lang="he"
      />
    ),
  }
}

describe('BookingForm diagnostic format choices', () => {
  it('offers Meet and clinic on a Friday-morning slot — no hybrid, no address input', () => {
    const { onChange } = renderForm(diagnostic60, FRIDAY_10)

    expect(screen.getByRole('button', { name: /וירטואלי/ })).toBeTruthy()
    const clinic = screen.getByRole('button', { name: /בקליניקה/ })
    expect(clinic).toBeTruthy()
    // Hybrid is never offered on the diagnostic route.
    expect(screen.queryByText('היברידי')).toBeNull()
    // No free-text address field for the fixed clinic address.
    expect(screen.queryByPlaceholderText('רחוב הרצל 1, תל אביב')).toBeNull()

    fireEvent.click(clinic)
    expect(onChange).toHaveBeenCalled()
  })

  it('shows the fixed clinic address when clinic is picked', () => {
    renderForm(diagnostic60, FRIDAY_10, vi.fn(), { locationMode: 'in_person' })
    expect(screen.getByText(/33 ברשבסקי, קליניקה 103/)).toBeTruthy()
  })

  it('offers only Meet on a non-Friday slot and coerces a stale clinic pick', () => {
    renderForm(diagnostic60, THURSDAY_1830, vi.fn(), { locationMode: 'in_person' })
    expect(screen.getByRole('button', { name: /וירטואלי/ })).toBeTruthy()
    expect(screen.queryByText('בקליניקה')).toBeNull()
    expect(screen.queryByText('היברידי')).toBeNull()
    // The stale in_person state is not shown as active anywhere.
    expect(screen.queryByText(/קליניקה 103/)).toBeNull()
  })

  it('keeps all three formats switchable on public meeting types', () => {
    const { onChange } = renderForm(intro30, THURSDAY_1830)

    expect(screen.getByRole('button', { name: /וירטואלי/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /היברידי/ })).toBeTruthy()
    const inPerson = screen.getByRole('button', { name: /פנים אל פנים הזן כתובת/ })
    expect(inPerson).toBeTruthy()

    fireEvent.click(inPerson)
    expect(onChange).toHaveBeenCalled()
  })
})

// The form is fully controlled (state lives in App), so submission tests
// need a stateful wrapper for field edits to take effect.
function StatefulForm({ initial, onSubmit, meetingType, selectedSlot }) {
  const [data, setData] = useState(initial)
  return (
    <BookingForm
      selectedSlot={selectedSlot}
      meetingType={meetingType}
      userTz="Asia/Jerusalem"
      formData={data}
      onChange={setData}
      onSubmit={onSubmit}
      onBack={vi.fn()}
      lang="he"
    />
  )
}

describe('BookingForm diagnostic subject and focus area', () => {
  const fillRequired = () => {
    fireEvent.change(screen.getByPlaceholderText('ישראל ישראלי'), { target: { value: 'ליד בדיקה' } })
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), { target: { value: 'lead@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('050-123-4567'), { target: { value: '0501234567' } })
  }

  it('fixes the subject as diagnostic and offers an optional focus area', () => {
    renderForm(diagnostic60, FRIDAY_10)
    // Subject rendered as a fixed value, not an editable textarea.
    expect(screen.getByText('איבחון')).toBeTruthy()
    expect(screen.queryByPlaceholderText('תיאור קצר של מה שתרצה לדון בו')).toBeNull()
    // Optional focus area with the coach-supplied example domains.
    expect(screen.getByText('התחומים בהם אתם מעוניינים להתמקד או מזהים כרגע חסמים ותקיעות')).toBeTruthy()
    expect(screen.getByText(/זוגיות/)).toBeTruthy()
  })

  it('submits the fixed subject alone when no focus is given', async () => {
    const onSubmit = vi.fn()
    render(<StatefulForm initial={{ ...baseForm }} onSubmit={onSubmit} meetingType={diagnostic60} selectedSlot={FRIDAY_10} />)
    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: 'אישור הזמנה' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'איבחון',
      locationMode: 'virtual',
      meetingLocation: '',
    }))
  })

  it('composes the subject from the fixed value plus the focus area', async () => {
    const onSubmit = vi.fn()
    render(<StatefulForm initial={{ ...baseForm, focus: 'זוגיות' }} onSubmit={onSubmit} meetingType={diagnostic60} selectedSlot={FRIDAY_10} />)
    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: 'אישור הזמנה' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ subject: 'איבחון - זוגיות' }))
  })

  it('still requires a free-text subject on public meeting types', async () => {
    const onSubmit = vi.fn()
    render(<StatefulForm initial={{ ...baseForm }} onSubmit={onSubmit} meetingType={intro30} selectedSlot={THURSDAY_1830} />)
    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: 'אישור הזמנה' }))
    await waitFor(() => expect(screen.getByText('נושא הפגישה הוא שדה חובה')).toBeTruthy())
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
