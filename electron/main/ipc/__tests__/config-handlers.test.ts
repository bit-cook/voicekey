import { beforeEach, describe, expect, it, vi } from 'vitest'
import createIPCMock from 'electron-mock-ipc'
import {
  IPC_CHANNELS,
  type ASRConfig,
  type LLMRefineConfig,
  type RefineConnectionResult,
} from '@electron/shared/types'

type HandlerMap = Map<string, (event: unknown, ...args: unknown[]) => unknown>

let mockConfigManager: {
  getConfig: ReturnType<typeof vi.fn>
  setAppConfig: ReturnType<typeof vi.fn>
  setASRConfig: ReturnType<typeof vi.fn>
  setLLMRefineConfig: ReturnType<typeof vi.fn>
  setHotkeyConfig: ReturnType<typeof vi.fn>
}
let mockBroadcastLanguageSnapshot: ReturnType<typeof vi.fn>
let mockGetMainLanguageSnapshot: ReturnType<typeof vi.fn>
let mockSetMainLanguage: ReturnType<typeof vi.fn>
let mockHotkeyManager: { unregisterAll: ReturnType<typeof vi.fn> }
let mockIoHookManager: { removeAllListeners: ReturnType<typeof vi.fn> }
let mockASRProviderInstance: { testConnection: ReturnType<typeof vi.fn> }
let mockASRProviderCtor: ReturnType<typeof vi.fn>
let mockRefineService: { testConnection: ReturnType<typeof vi.fn> }

const setupModuleMocks = (ipcMain: unknown, ipcRenderer?: unknown) => {
  vi.doMock('electron', () => ({ ipcMain, ipcRenderer }))
  vi.doMock('../../config-manager', () => ({ configManager: mockConfigManager }))
  vi.doMock('../../i18n', () => ({
    broadcastLanguageSnapshot: mockBroadcastLanguageSnapshot,
    getMainLanguageSnapshot: mockGetMainLanguageSnapshot,
    setMainLanguage: mockSetMainLanguage,
  }))
  vi.doMock('../../hotkey-manager', () => ({ hotkeyManager: mockHotkeyManager }))
  vi.doMock('../../iohook-manager', () => ({ ioHookManager: mockIoHookManager }))
  vi.doMock('../../asr-provider', () => ({ ASRProvider: mockASRProviderCtor }))
}

const createHandlers = () => {
  const handlers: HandlerMap = new Map()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
  }
  return { ipcMain, handlers }
}

const createConfigDeps = (overrides: Record<string, unknown> = {}) => ({
  updateAutoLaunchState: vi.fn(),
  refreshLocalizedUi: vi.fn(),
  initializeASRProvider: vi.fn(),
  registerGlobalHotkeys: vi.fn(),
  getAsrProvider: vi.fn(),
  getRefineService: vi.fn(() => mockRefineService as any),
  ...overrides,
})

const setupCommonMocks = () => {
  mockConfigManager = {
    getConfig: vi.fn(() => ({ app: {}, asr: {}, llmRefine: {}, hotkey: {} })),
    setAppConfig: vi.fn(),
    setASRConfig: vi.fn(),
    setLLMRefineConfig: vi.fn(),
    setHotkeyConfig: vi.fn(),
  }
  mockBroadcastLanguageSnapshot = vi.fn()
  mockGetMainLanguageSnapshot = vi.fn(() => ({
    setting: 'system',
    resolved: 'en',
    locale: 'en-US',
  }))
  mockSetMainLanguage = vi.fn().mockResolvedValue(undefined)
  mockHotkeyManager = { unregisterAll: vi.fn() }
  mockIoHookManager = { removeAllListeners: vi.fn() }
  mockASRProviderInstance = { testConnection: vi.fn().mockResolvedValue(true) }
  mockRefineService = { testConnection: vi.fn().mockResolvedValue({ ok: true }) }
  const MockImpl = function () {
    return mockASRProviderInstance
  }
  mockASRProviderCtor = vi.fn(MockImpl)
}

describe('config-handlers (unit)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonMocks()
  })

  it('returns config on CONFIG_GET', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    initConfigHandlers(createConfigDeps())
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.CONFIG_GET)
    expect(handler).toBeDefined()
    const result = await handler?.(null)
    expect(mockConfigManager.getConfig).toHaveBeenCalled()
    expect(result).toEqual({ app: {}, asr: {}, llmRefine: {}, hotkey: {} })
  })

  it('returns language snapshot on APP_LANGUAGE_GET', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    initConfigHandlers(createConfigDeps())
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.APP_LANGUAGE_GET)
    const snapshot = await handler?.(null)
    expect(mockGetMainLanguageSnapshot).toHaveBeenCalled()
    expect(snapshot).toEqual({
      setting: 'system',
      resolved: 'en',
      locale: 'en-US',
    })
  })

  it('updates app config and triggers language + autolaunch effects', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    const updateAutoLaunchState = vi.fn()
    const refreshLocalizedUi = vi.fn()

    initConfigHandlers(
      createConfigDeps({
        updateAutoLaunchState,
        refreshLocalizedUi,
      }),
    )
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.CONFIG_SET)
    await handler?.(null, { app: { autoLaunch: true, language: 'en' } })

    expect(mockConfigManager.setAppConfig).toHaveBeenCalledWith({
      autoLaunch: true,
      language: 'en',
    })
    expect(updateAutoLaunchState).toHaveBeenCalledWith(true)
    expect(mockSetMainLanguage).toHaveBeenCalledWith('en')
    expect(mockBroadcastLanguageSnapshot).toHaveBeenCalled()
    expect(refreshLocalizedUi).toHaveBeenCalled()
  })

  it('updates app config and disables autolaunch when requested', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    const updateAutoLaunchState = vi.fn()

    initConfigHandlers(
      createConfigDeps({
        updateAutoLaunchState,
      }),
    )
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.CONFIG_SET)
    await handler?.(null, { app: { autoLaunch: false } })

    expect(mockConfigManager.setAppConfig).toHaveBeenCalledWith({
      autoLaunch: false,
    })
    expect(updateAutoLaunchState).toHaveBeenCalledWith(false)
  })

  it('updates ASR config and reinitializes provider', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    const initializeASRProvider = vi.fn()
    initConfigHandlers(
      createConfigDeps({
        initializeASRProvider,
      }),
    )
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.CONFIG_SET)
    await handler?.(null, { asr: { region: 'intl' } })
    expect(mockConfigManager.setASRConfig).toHaveBeenCalledWith({ region: 'intl' })
    expect(initializeASRProvider).toHaveBeenCalled()
  })

  it('updates text refine config without reinitializing a separate provider', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    initConfigHandlers(createConfigDeps())
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.CONFIG_SET)
    await handler?.(null, {
      llmRefine: {
        enabled: false,
        endpoint: 'https://example.com/v1',
        model: 'gpt-4.1-mini',
        apiKey: 'test-key',
      },
    })
    expect(mockConfigManager.setLLMRefineConfig).toHaveBeenCalledWith({
      enabled: false,
      endpoint: 'https://example.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'test-key',
    })
  })

  it('updates hotkey config and re-registers listeners', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    const registerGlobalHotkeys = vi.fn()
    initConfigHandlers(
      createConfigDeps({
        registerGlobalHotkeys,
      }),
    )
    registerConfigHandlers()

    const handler = handlers.get(IPC_CHANNELS.CONFIG_SET)
    await handler?.(null, { hotkey: { pttKey: 'Alt', toggleSettings: 'Command+Shift+,' } })

    expect(mockConfigManager.setHotkeyConfig).toHaveBeenCalledWith({
      pttKey: 'Alt',
      toggleSettings: 'Command+Shift+,',
    })
    expect(mockHotkeyManager.unregisterAll).toHaveBeenCalled()
    expect(mockIoHookManager.removeAllListeners).toHaveBeenCalledWith('keydown')
    expect(mockIoHookManager.removeAllListeners).toHaveBeenCalledWith('keyup')
    expect(registerGlobalHotkeys).toHaveBeenCalled()
  })

  it('tests connection with provided config using ASRProvider', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    initConfigHandlers(createConfigDeps())
    registerConfigHandlers()

    const config: ASRConfig = {
      provider: 'glm',
      region: 'cn',
      apiKeys: { cn: 'k', intl: '' },
    }

    const handler = handlers.get(IPC_CHANNELS.CONFIG_TEST)
    const result = await handler?.(null, config)
    expect(mockASRProviderCtor).toHaveBeenCalledWith(config)
    expect(mockASRProviderInstance.testConnection).toHaveBeenCalled()
    expect(result).toBe(true)
  })

  it('tests refinement connection using current refine service', async () => {
    const { ipcMain, handlers } = createHandlers()
    setupModuleMocks(ipcMain)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    initConfigHandlers(createConfigDeps())
    registerConfigHandlers()

    const config: LLMRefineConfig = {
      enabled: true,
      endpoint: 'https://example.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'test-key',
    }

    const handler = handlers.get(IPC_CHANNELS.CONFIG_REFINE_TEST)
    const result = (await handler?.(null, config)) as RefineConnectionResult
    expect(mockRefineService.testConnection).toHaveBeenCalledWith(config)
    expect(result).toEqual({ ok: true })
  })
})

describe('config-handlers (ipc invoke)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonMocks()
  })

  it('handles CONFIG_GET via ipcRenderer.invoke', async () => {
    const mocked = createIPCMock()
    setupModuleMocks(mocked.ipcMain, mocked.ipcRenderer)
    const { initConfigHandlers, registerConfigHandlers } = await import('../config-handlers')

    initConfigHandlers(createConfigDeps())
    registerConfigHandlers()

    const result = await mocked.ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET)
    expect(mockConfigManager.getConfig).toHaveBeenCalled()
    expect(result).toEqual({ app: {}, asr: {}, llmRefine: {}, hotkey: {} })
  })
})
