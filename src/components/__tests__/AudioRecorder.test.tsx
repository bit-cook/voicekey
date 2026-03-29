import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioRecorder } from '../AudioRecorder'

type StartListener = ((payload: { sessionId: string }) => void) | null
type StopListener = (() => void) | null

let startListener: StartListener = null
let stopListener: StopListener = null

const mockSendAudioChunk = vi.fn()
const mockSendAudioLevel = vi.fn()
const mockSendError = vi.fn()
const mockStopSession = vi.fn()
const mockGetUserMedia = vi.fn()
const mockTrackStop = vi.fn()
const mockRequestAnimationFrame = vi.fn(() => 1)
const mockCancelAnimationFrame = vi.fn()

class MockAudioContext {
  close = vi.fn().mockResolvedValue(undefined)

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
    }
  }

  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 4,
      getByteFrequencyData: (array: Uint8Array) => {
        array.fill(32)
      },
    }
  }
}

let chunkCounter = 0

class MockMediaRecorder {
  static isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/webm')

  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    const blob = new Blob([`chunk-${(chunkCounter += 1)}`], { type: this.mimeType })
    this.ondataavailable?.({ data: blob })
    this.onstop?.()
  }
}

describe('AudioRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    startListener = null
    stopListener = null
    chunkCounter = 0

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        onStartRecording: vi.fn((callback: (payload: { sessionId: string }) => void) => {
          startListener = callback
          return () => {
            startListener = null
          }
        }),
        onStopRecording: vi.fn((callback: () => void) => {
          stopListener = callback
          return () => {
            stopListener = null
          }
        }),
        sendAudioChunk: mockSendAudioChunk,
        sendAudioLevel: mockSendAudioLevel,
        sendError: mockSendError,
        stopSession: mockStopSession,
      },
    })

    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: MockMediaRecorder,
    })
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: mockRequestAnimationFrame,
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: mockCancelAnimationFrame,
    })

    mockGetUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: mockTrackStop }],
    })

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: mockGetUserMedia,
      },
    })
  })

  it('rotates recording every 29 seconds and marks the last chunk as final', async () => {
    render(<AudioRecorder />)

    await act(async () => {
      await startListener?.({ sessionId: 'session-1' })
    })

    await act(async () => {
      vi.advanceTimersByTime(29000)
      await Promise.resolve()
    })

    expect(mockSendAudioChunk).toHaveBeenCalledTimes(1)
    expect(mockSendAudioChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: 'session-1',
        chunkIndex: 0,
        isFinal: false,
        mimeType: 'audio/webm',
      }),
    )

    await act(async () => {
      stopListener?.()
      await Promise.resolve()
    })

    expect(mockSendAudioChunk).toHaveBeenCalledTimes(2)
    expect(mockSendAudioChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: 'session-1',
        chunkIndex: 1,
        isFinal: true,
        mimeType: 'audio/webm',
      }),
    )
  })

  it('auto-stops the session at the 3 minute limit', async () => {
    render(<AudioRecorder />)

    await act(async () => {
      await startListener?.({ sessionId: 'session-1' })
    })

    await act(async () => {
      vi.advanceTimersByTime(180000)
      await Promise.resolve()
    })

    expect(mockStopSession).toHaveBeenCalledTimes(1)
  })
})
