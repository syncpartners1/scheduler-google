import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TimeSlotPicker from '../src/components/TimeSlotPicker.jsx'
import { MEETING_TYPES } from '../src/config.js'

afterEach(cleanup)

const intro30      = MEETING_TYPES.find(mt => mt.id === 'intro_30')
const coaching60   = MEETING_TYPES.find(mt => mt.id === 'coaching_60')
const diagnostic60 = MEETING_TYPES.find(mt => mt.id === 'diagnostic_60')

function renderPicker(meetingType, onMeetingTypeChange = vi.fn()) {
  return {
    onMeetingTypeChange,
    ...render(
      <TimeSlotPicker
        selectedDate={new Date(2026, 10, 19)}
        busySlots={[]}
        loading={true}            // picker must render even while slots load
        error={null}
        userTz="Asia/Jerusalem"
        meetingType={meetingType}
        onMeetingTypeChange={onMeetingTypeChange}
        onSelect={vi.fn()}
        onBack={vi.fn()}
        lang="he"
      />
    ),
  }
}

describe('TimeSlotPicker meeting-type locking', () => {
  it('locks the picker to the linked hidden type (dedicated diagnostic route)', () => {
    const { onMeetingTypeChange } = renderPicker(diagnostic60)

    // The diagnostic type is shown as a static chip…
    expect(screen.getByText('פגישת איבחון')).toBeTruthy()
    // …not as a clickable button, so the type cannot be switched.
    expect(screen.queryByRole('button', { name: /פגישת איבחון/ })).toBeNull()
    // No other meeting type is offered on the dedicated route.
    expect(screen.queryByText('הכרות')).toBeNull()
    expect(screen.queryByText('פגישה בתשלום')).toBeNull()
    expect(onMeetingTypeChange).not.toHaveBeenCalled()
  })

  it('keeps every public type switchable and the hidden type out of public links', () => {
    const { onMeetingTypeChange } = renderPicker(intro30)

    // Every public type renders as a clickable chip.
    const publicTypes = MEETING_TYPES.filter(mt => !mt.hidden)
    const typeButtons = screen
      .getAllByRole('button')
      .filter(b => /דק׳/.test(b.textContent))
    expect(typeButtons).toHaveLength(publicTypes.length)

    // The hidden diagnostic type is not offered on a public link.
    expect(screen.queryByText('פגישת איבחון')).toBeNull()

    // Switching to another public type still works.
    fireEvent.click(screen.getByRole('button', { name: /פגישה בתשלום/ }))
    expect(onMeetingTypeChange).toHaveBeenCalledWith(coaching60)
  })
})
