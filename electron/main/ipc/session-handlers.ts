import { ipcMain } from 'electron'
import { IPC_CHANNELS, type AudioChunkPayload, type VoiceSession } from '../../shared/types'

export type SessionHandlersDeps = {
  handleStartRecording: () => Promise<void>
  handleStopRecording: () => Promise<void>
  handleAudioChunk: (payload: AudioChunkPayload) => Promise<void>
  handleCancelSession: () => Promise<void>
  getCurrentSession: () => VoiceSession | null
}

let deps: SessionHandlersDeps

export function initSessionHandlers(dependencies: SessionHandlersDeps): void {
  deps = dependencies
}

export function registerSessionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_START, async () => {
    await deps.handleStartRecording()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async () => {
    await deps.handleStopRecording()
  })

  ipcMain.handle(IPC_CHANNELS.SESSION_STATUS, () => {
    return deps.getCurrentSession()?.status || 'idle'
  })

  ipcMain.on(IPC_CHANNELS.AUDIO_DATA, (_event, payload: AudioChunkPayload) => {
    void deps.handleAudioChunk(payload).catch((error) => {
      console.error('[IPC:Session] Audio chunk processing failed:', error)
    })
  })

  ipcMain.handle(IPC_CHANNELS.CANCEL_SESSION, () => deps.handleCancelSession())
}
