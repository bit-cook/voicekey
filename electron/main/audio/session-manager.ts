import { IPC_CHANNELS, type RecordingStartPayload, type VoiceSession } from '../../shared/types'
import { showOverlay, hideOverlay, updateOverlay, showErrorAndHide } from '../window/overlay'
import { getBackgroundWindow } from '../window/background'
import { t } from '../i18n'

let currentSession: VoiceSession | null = null

export function getCurrentSession(): VoiceSession | null {
  return currentSession
}

export function setSessionError(): void {
  if (currentSession) {
    currentSession.status = 'error'
  }
}

export function clearSession(): void {
  currentSession = null
}

export function updateSession(updates: Partial<VoiceSession>): void {
  if (currentSession) {
    Object.assign(currentSession, updates)
  }
}

export async function handleStartRecording(): Promise<void> {
  const startTimestamp = Date.now()
  console.log('[Audio:Session] handleStartRecording triggered')

  if (currentSession && currentSession.status === 'recording') {
    console.log('[Audio:Session] Already recording, ignoring')
    return
  }

  try {
    showOverlay({ status: 'recording' })

    currentSession = {
      id: `session-${Date.now()}`,
      startTime: new Date(),
      status: 'recording',
    }

    const bgWindow = getBackgroundWindow()
    if (!bgWindow) {
      console.error('[Audio:Session] backgroundWindow is not available')
      showErrorAndHide(t('errors.internal'))
      currentSession = null
      return
    }

    const payload: RecordingStartPayload = { sessionId: currentSession.id }
    bgWindow.webContents.send(IPC_CHANNELS.SESSION_START, payload)
    const duration = Date.now() - startTimestamp
    console.log(`[Audio:Session] Recording start completed in ${duration}ms`)
  } catch (error) {
    console.error('[Audio:Session] Failed to start recording:', error)
    showErrorAndHide(t('errors.startFailed'))
    currentSession = null
  }
}

export async function handleStopRecording(): Promise<void> {
  if (!currentSession || currentSession.status !== 'recording') {
    console.log(
      '[Audio:Session] handleStopRecording: no active recording session, status:',
      currentSession?.status,
    )
    return
  }

  try {
    const recordingDuration = Date.now() - currentSession.startTime.getTime()
    console.log(`[Audio:Session] Recording duration: ${recordingDuration}ms`)

    currentSession.duration = recordingDuration
    currentSession.status = 'processing'

    updateOverlay({ status: 'processing' })

    const bgWindow = getBackgroundWindow()
    if (bgWindow) {
      console.log('[Audio:Session] Sending SESSION_STOP to backgroundWindow')
      bgWindow.webContents.send(IPC_CHANNELS.SESSION_STOP)
    } else {
      console.error('[Audio:Session] Cannot send SESSION_STOP: backgroundWindow not available')
      showErrorAndHide(t('errors.stopFailed'))
    }
  } catch (error) {
    console.error('[Audio:Session] Failed to stop recording:', error)
    showErrorAndHide(t('errors.stopFailed'))
  }
}

export async function handleCancelSession(): Promise<void> {
  console.log('[Audio:Session] handleCancelSession triggered')

  hideOverlay()

  if (currentSession) {
    console.log('[Audio:Session] Cancelling session:', currentSession.id)
    currentSession = null
  }

  const bgWindow = getBackgroundWindow()
  if (bgWindow) {
    bgWindow.webContents.send(IPC_CHANNELS.SESSION_STOP)
  }
}
