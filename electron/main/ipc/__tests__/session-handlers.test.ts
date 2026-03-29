import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, type AudioChunkPayload } from '@electron/shared/types'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
type IpcListener = (event: unknown, ...args: unknown[]) => void

const createIpcMain = () => {
  const handlers = new Map<string, IpcHandler>()
  const listeners = new Map<string, IpcListener>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, listener: IpcListener) => {
      listeners.set(channel, listener)
    }),
  }
  return { ipcMain, handlers, listeners }
}

const setupModuleMocks = (ipcMain: unknown) => {
  vi.doMock('electron', () => ({ ipcMain }))
}

const createChunkPayload = (): AudioChunkPayload => {
  const audioBuffer = new Uint8Array([1, 2, 3]).buffer
  return {
    sessionId: 'session-1',
    chunkIndex: 0,
    isFinal: true,
    mimeType: 'audio/webm',
    buffer: audioBuffer,
  }
}

describe('session-handlers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('handles start/stop/status/cancel requests', async () => {
    const { ipcMain, handlers } = createIpcMain()
    setupModuleMocks(ipcMain)
    const { initSessionHandlers, registerSessionHandlers } = await import('../session-handlers')

    const deps = {
      handleStartRecording: vi.fn().mockResolvedValue(undefined),
      handleStopRecording: vi.fn().mockResolvedValue(undefined),
      handleAudioChunk: vi.fn().mockResolvedValue(undefined),
      handleCancelSession: vi.fn().mockResolvedValue(undefined),
      getCurrentSession: vi.fn(() => ({ status: 'recording' })),
    }

    initSessionHandlers(deps as any)
    registerSessionHandlers()

    await handlers.get(IPC_CHANNELS.SESSION_START)?.(null)
    await handlers.get(IPC_CHANNELS.SESSION_STOP)?.(null)
    const status = await handlers.get(IPC_CHANNELS.SESSION_STATUS)?.(null)
    await handlers.get(IPC_CHANNELS.CANCEL_SESSION)?.(null)

    expect(deps.handleStartRecording).toHaveBeenCalled()
    expect(deps.handleStopRecording).toHaveBeenCalled()
    expect(status).toBe('recording')
    expect(deps.handleCancelSession).toHaveBeenCalled()
  })

  it('forwards audio chunk payloads to the processor', async () => {
    const { ipcMain, listeners } = createIpcMain()
    setupModuleMocks(ipcMain)
    const { initSessionHandlers, registerSessionHandlers } = await import('../session-handlers')

    const handleAudioChunk = vi.fn().mockResolvedValue(undefined)
    initSessionHandlers({
      handleStartRecording: vi.fn(),
      handleStopRecording: vi.fn(),
      handleAudioChunk,
      handleCancelSession: vi.fn(),
      getCurrentSession: vi.fn(() => null),
    })
    registerSessionHandlers()

    const payload = createChunkPayload()
    listeners.get(IPC_CHANNELS.AUDIO_DATA)?.(null, payload)
    await new Promise((resolve) => setImmediate(resolve))

    expect(handleAudioChunk).toHaveBeenCalledTimes(1)
    expect(handleAudioChunk).toHaveBeenCalledWith(payload)
  })

  it('logs error when audio chunk processing fails', async () => {
    const { ipcMain, listeners } = createIpcMain()
    setupModuleMocks(ipcMain)
    const { initSessionHandlers, registerSessionHandlers } = await import('../session-handlers')

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handleAudioChunk = vi.fn().mockRejectedValue(new Error('fail'))
    initSessionHandlers({
      handleStartRecording: vi.fn(),
      handleStopRecording: vi.fn(),
      handleAudioChunk,
      handleCancelSession: vi.fn(),
      getCurrentSession: vi.fn(() => null),
    })
    registerSessionHandlers()

    listeners.get(IPC_CHANNELS.AUDIO_DATA)?.(null, createChunkPayload())
    await new Promise((resolve) => setImmediate(resolve))

    expect(consoleError).toHaveBeenCalledWith(
      '[IPC:Session] Audio chunk processing failed:',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })
})
