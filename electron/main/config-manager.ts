import { safeStorage } from 'electron'
import Store from 'electron-store'
import {
  AppConfig,
  AppPreferences,
  ASRConfig,
  HotkeyConfig,
  LLMRefineConfig,
} from '../shared/types'
import { DEFAULT_HOTKEYS, LLM_REFINE } from '../shared/constants'

const ENCRYPTED_PREFIX = 'enc:'

interface ConfigSchema {
  app: AppPreferences
  asr: ASRConfig
  llmRefine: LLMRefineConfig
  hotkey: HotkeyConfig
}

const defaultLLMRefineConfig: LLMRefineConfig = {
  enabled: LLM_REFINE.ENABLED,
  endpoint: LLM_REFINE.ENDPOINT,
  model: LLM_REFINE.MODEL,
  apiKey: LLM_REFINE.API_KEY,
}

const defaultConfig: AppConfig = {
  app: {
    language: 'system',
    autoLaunch: false,
  },
  asr: {
    provider: 'glm',
    region: 'cn',
    apiKeys: {
      cn: '',
      intl: '',
    },
    lowVolumeMode: true,
    endpoint: '',
    language: 'auto',
  },
  llmRefine: defaultLLMRefineConfig,
  hotkey: {
    pttKey: DEFAULT_HOTKEYS.PTT,
    toggleSettings: DEFAULT_HOTKEYS.SETTINGS,
  },
}

function normalizeLLMRefineConfig(config?: Partial<LLMRefineConfig>): LLMRefineConfig {
  return {
    ...defaultLLMRefineConfig,
    enabled: typeof config?.enabled === 'boolean' ? config.enabled : defaultLLMRefineConfig.enabled,
    endpoint: config?.endpoint ?? defaultLLMRefineConfig.endpoint,
    model: config?.model ?? defaultLLMRefineConfig.model,
    apiKey: config?.apiKey ?? defaultLLMRefineConfig.apiKey,
  }
}

function readLegacyOpenAICompatibleField(
  config: Record<string, unknown>,
  key: 'endpoint' | 'model' | 'apiKey',
): string {
  const openaiCompatible = config.openaiCompatible
  if (!openaiCompatible || typeof openaiCompatible !== 'object') {
    return defaultLLMRefineConfig[key]
  }

  const value = (openaiCompatible as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : defaultLLMRefineConfig[key]
}

function migrateLLMRefineConfig(config: unknown): LLMRefineConfig | null {
  if (typeof config === 'boolean') {
    return defaultLLMRefineConfig
  }

  if (!config || typeof config !== 'object') {
    return null
  }

  const rawConfig = config as Record<string, unknown>

  if ('provider' in rawConfig || 'openaiCompatible' in rawConfig) {
    if (rawConfig.provider === 'openai-compatible') {
      return normalizeLLMRefineConfig({
        enabled:
          typeof rawConfig.enabled === 'boolean'
            ? rawConfig.enabled
            : defaultLLMRefineConfig.enabled,
        endpoint: readLegacyOpenAICompatibleField(rawConfig, 'endpoint'),
        model: readLegacyOpenAICompatibleField(rawConfig, 'model'),
        apiKey: readLegacyOpenAICompatibleField(rawConfig, 'apiKey'),
      })
    }

    return defaultLLMRefineConfig
  }

  if ('endpoint' in rawConfig || 'model' in rawConfig || 'apiKey' in rawConfig) {
    return normalizeLLMRefineConfig(rawConfig as Partial<LLMRefineConfig>)
  }

  if ('enabled' in rawConfig) {
    return defaultLLMRefineConfig
  }

  return null
}

export class ConfigManager {
  private store: Store<ConfigSchema>

  constructor() {
    this.store = new Store<ConfigSchema>({
      defaults: defaultConfig,
      name: 'voice-key-config',
    })
    this.migrate()
  }

  private encryptKey(plainText: string): string {
    if (!plainText) return plainText

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plainText)
        return ENCRYPTED_PREFIX + encrypted.toString('base64')
      }
    } catch (error) {
      console.error('[ConfigManager] Failed to encrypt API key:', error)
    }

    return plainText
  }

  private decryptKey(value: string): string {
    if (!value || !value.startsWith(ENCRYPTED_PREFIX)) {
      return value
    }

    try {
      const base64 = value.slice(ENCRYPTED_PREFIX.length)
      const buffer = Buffer.from(base64, 'base64')
      return safeStorage.decryptString(buffer)
    } catch (error) {
      console.error('[ConfigManager] Failed to decrypt API key:', error)
      return ''
    }
  }

  private migrate(): void {
    const asrConfig = this.store.get('asr') as unknown as Record<string, unknown> | undefined
    if (asrConfig?.apiKey) {
      const currentApiKeys = this.store.get('asr.apiKeys', { cn: '', intl: '' })
      if (!currentApiKeys.cn) {
        this.store.set('asr.apiKeys.cn', asrConfig.apiKey)
        this.store.delete('asr.apiKey' as never)
      }
    }

    if (
      asrConfig &&
      typeof asrConfig === 'object' &&
      !Object.prototype.hasOwnProperty.call(asrConfig, 'lowVolumeMode')
    ) {
      this.store.set('asr.lowVolumeMode', false)
    }

    const llmRefineConfig = this.store.get('llmRefine')
    const migratedLLMRefineConfig = migrateLLMRefineConfig(llmRefineConfig)
    if (migratedLLMRefineConfig) {
      this.store.set('llmRefine', migratedLLMRefineConfig)
    }
  }

  // Must be called after app.whenReady() because safeStorage needs ready on Windows/Linux.
  migrateApiKeysEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) return

    const apiKeys = this.store.get('asr.apiKeys', { cn: '', intl: '' })
    for (const region of ['cn', 'intl'] as const) {
      const key = apiKeys[region]
      if (key && !key.startsWith(ENCRYPTED_PREFIX)) {
        apiKeys[region] = this.encryptKey(key)
      }
    }
    this.store.set('asr.apiKeys', apiKeys)

    const llmRefine = normalizeLLMRefineConfig(this.store.get('llmRefine', defaultConfig.llmRefine))
    if (llmRefine.apiKey && !llmRefine.apiKey.startsWith(ENCRYPTED_PREFIX)) {
      this.store.set('llmRefine', {
        ...llmRefine,
        apiKey: this.encryptKey(llmRefine.apiKey),
      })
    }
  }

  getConfig(): AppConfig {
    return {
      app: this.getAppConfig(),
      asr: this.getASRConfig(),
      llmRefine: this.getLLMRefineConfig(),
      hotkey: this.getHotkeyConfig(),
    }
  }

  getAppConfig(): AppPreferences {
    return this.store.get('app', defaultConfig.app)
  }

  setAppConfig(config: Partial<AppPreferences>): void {
    const current = this.getAppConfig()
    this.store.set('app', { ...current, ...config })
  }

  getASRConfig(): ASRConfig {
    const config = this.store.get('asr', defaultConfig.asr)
    if (!config.apiKeys) {
      config.apiKeys = { cn: '', intl: '' }
    }
    config.apiKeys = {
      cn: this.decryptKey(config.apiKeys.cn),
      intl: this.decryptKey(config.apiKeys.intl),
    }
    if (!config.region) {
      config.region = 'cn'
    }
    if (typeof config.lowVolumeMode !== 'boolean') {
      config.lowVolumeMode = defaultConfig.asr.lowVolumeMode
    }
    return config
  }

  setASRConfig(config: Partial<ASRConfig>): void {
    const current = this.getASRConfig()
    const merged = { ...current, ...config }
    if (merged.apiKeys) {
      merged.apiKeys = {
        cn: this.encryptKey(merged.apiKeys.cn),
        intl: this.encryptKey(merged.apiKeys.intl),
      }
    }
    this.store.set('asr', merged)
  }

  getLLMRefineConfig(): LLMRefineConfig {
    const config = normalizeLLMRefineConfig(this.store.get('llmRefine', defaultConfig.llmRefine))
    return {
      ...config,
      apiKey: this.decryptKey(config.apiKey),
    }
  }

  setLLMRefineConfig(config: Partial<LLMRefineConfig>): void {
    const current = this.getLLMRefineConfig()
    const merged = normalizeLLMRefineConfig({ ...current, ...config })
    this.store.set('llmRefine', {
      ...merged,
      apiKey: this.encryptKey(merged.apiKey),
    })
  }

  getHotkeyConfig(): HotkeyConfig {
    return this.store.get('hotkey', defaultConfig.hotkey)
  }

  setHotkeyConfig(config: Partial<HotkeyConfig>): void {
    const current = this.getHotkeyConfig()
    this.store.set('hotkey', { ...current, ...config })
  }

  reset(): void {
    this.store.clear()
  }

  isValid(): boolean {
    const asr = this.getASRConfig()
    const region = asr.region || 'cn'
    const key = asr.apiKeys?.[region]
    return !!key && key.length > 0
  }
}

export const configManager = new ConfigManager()
