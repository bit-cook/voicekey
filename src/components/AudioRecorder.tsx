import { useEffect, useRef } from 'react'
import { GLM_ASR } from '@electron/shared/constants'
import type { RecordingStartPayload } from '@electron/shared/types'

type StopMeta = {
  chunkIndex: number
  isFinal: boolean
  rotateAfterStop: boolean
}

export function AudioRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopMetaRef = useRef<StopMeta | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const currentChunkIndexRef = useRef(0)
  const currentMimeTypeRef = useRef('audio/webm')
  const isRecordingRef = useRef(false)
  const isSessionEndingRef = useRef(false)

  const clearChunkTimer = () => {
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current)
      chunkTimerRef.current = null
    }
  }

  const clearSessionMaxTimer = () => {
    if (sessionMaxTimerRef.current) {
      clearTimeout(sessionMaxTimerRef.current)
      sessionMaxTimerRef.current = null
    }
  }

  const releaseResources = () => {
    clearChunkTimer()
    clearSessionMaxTimer()

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    analyserRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    stopMetaRef.current = null
    currentSessionIdRef.current = null
    currentChunkIndexRef.current = 0
    currentMimeTypeRef.current = 'audio/webm'
    isRecordingRef.current = false
    isSessionEndingRef.current = false
  }

  const sendAudioLevel = () => {
    const analyser = analyserRef.current
    if (!analyser) return

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(dataArray)
    const sum = dataArray.reduce((a, b) => a + b, 0)
    const average = sum / dataArray.length
    const normalized = Math.min(average / 128, 1)
    window.electronAPI.sendAudioLevel(normalized)
    animationFrameRef.current = requestAnimationFrame(sendAudioLevel)
  }

  const handleRecorderStop = async () => {
    const sessionId = currentSessionIdRef.current
    const mimeType = currentMimeTypeRef.current
    const stopMeta = stopMetaRef.current ?? {
      chunkIndex: currentChunkIndexRef.current,
      isFinal: isSessionEndingRef.current,
      rotateAfterStop: !isSessionEndingRef.current,
    }
    stopMetaRef.current = null

    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []

    if (sessionId && blob.size > 0) {
      const buffer = await blob.arrayBuffer()
      window.electronAPI.sendAudioChunk({
        sessionId,
        chunkIndex: stopMeta.chunkIndex,
        isFinal: stopMeta.isFinal,
        mimeType,
        buffer,
      })
    } else {
      console.warn('[Renderer] Skipping empty audio chunk')
    }

    if (stopMeta.isFinal || isSessionEndingRef.current) {
      releaseResources()
      console.log('[Renderer] Final chunk sent, resources released')
      return
    }

    currentChunkIndexRef.current = stopMeta.chunkIndex + 1
    startChunkRecorder()
  }

  const requestRecorderStop = (nextStopMeta: StopMeta) => {
    if (nextStopMeta.isFinal) {
      isSessionEndingRef.current = true
    }

    const existingStopMeta = stopMetaRef.current
    if (existingStopMeta) {
      if (nextStopMeta.isFinal) {
        existingStopMeta.isFinal = true
        existingStopMeta.rotateAfterStop = false
      }
      return
    }

    const recorder = mediaRecorderRef.current
    if (!recorder) {
      if (nextStopMeta.isFinal) {
        releaseResources()
      }
      return
    }

    clearChunkTimer()
    stopMetaRef.current = {
      chunkIndex: nextStopMeta.chunkIndex,
      isFinal: nextStopMeta.isFinal,
      rotateAfterStop: nextStopMeta.rotateAfterStop && !nextStopMeta.isFinal,
    }

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  const scheduleChunkRotation = () => {
    clearChunkTimer()
    chunkTimerRef.current = setTimeout(() => {
      if (!isSessionEndingRef.current) {
        requestRecorderStop({
          chunkIndex: currentChunkIndexRef.current,
          isFinal: false,
          rotateAfterStop: true,
        })
      }
    }, GLM_ASR.REQUEST_MAX_DURATION_SECONDS * 1000)
  }

  const startChunkRecorder = () => {
    const stream = streamRef.current
    if (!stream) return

    const mediaRecorder = new MediaRecorder(stream, { mimeType: currentMimeTypeRef.current })
    mediaRecorderRef.current = mediaRecorder
    chunksRef.current = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      void handleRecorderStop()
    }

    mediaRecorder.onerror = (event) => {
      console.error('[Renderer] MediaRecorder error:', event)
      window.electronAPI.sendError(`MediaRecorder error: ${event}`)
      releaseResources()
    }

    mediaRecorder.start()
    scheduleChunkRotation()
    console.log(`[Renderer] Recording chunk ${currentChunkIndexRef.current} started`)
  }

  const startRecordingSession = async (payload: RecordingStartPayload) => {
    if (isRecordingRef.current) {
      console.warn('[Renderer] Already recording, ignoring start request')
      return
    }

    try {
      releaseResources()

      currentSessionIdRef.current = payload.sessionId
      currentChunkIndexRef.current = 0
      isRecordingRef.current = true
      isSessionEndingRef.current = false

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      analyserRef.current = analyser

      sendAudioLevel()

      let mimeType = 'audio/wav'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm'
      }
      currentMimeTypeRef.current = mimeType

      startChunkRecorder()

      sessionMaxTimerRef.current = setTimeout(() => {
        if (!isSessionEndingRef.current && currentSessionIdRef.current === payload.sessionId) {
          void window.electronAPI.stopSession()
        }
      }, GLM_ASR.SESSION_MAX_DURATION_SECONDS * 1000)
    } catch (error) {
      console.error('[Renderer] Failed to start recording:', error)
      window.electronAPI.sendError(`Failed to access microphone: ${error}`)
      releaseResources()
    }
  }

  const stopRecordingSession = () => {
    console.log('[Renderer] onStopRecording triggered')
    requestRecorderStop({
      chunkIndex: currentChunkIndexRef.current,
      isFinal: true,
      rotateAfterStop: false,
    })
  }

  useEffect(() => {
    const removeStartRecordingListener = window.electronAPI.onStartRecording((payload) => {
      void startRecordingSession(payload)
    })

    const removeStopRecordingListener = window.electronAPI.onStopRecording(() => {
      stopRecordingSession()
    })

    return () => {
      removeStartRecordingListener?.()
      removeStopRecordingListener?.()
      releaseResources()
      console.log('[Renderer] Component unmounted, resources released')
    }
  }, [])

  return null
}
