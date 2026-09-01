import { safeStorage, app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 秘密情報は OS キーチェーン（safeStorage）で暗号化して保存する（設計 §11）。
 *
 * 平文でシナリオに書かせない。シナリオ側は {{secret.KEY}} で参照するだけ。
 */
export class SecretStore {
  private cache: Record<string, string> | undefined

  constructor(private readonly file = join(app.getPath('userData'), 'secrets.bin')) {}

  private available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache

    try {
      const encrypted = await readFile(this.file)
      const json = this.available()
        ? safeStorage.decryptString(encrypted)
        : encrypted.toString('utf8')
      this.cache = JSON.parse(json) as Record<string, string>
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private async persist(values: Record<string, string>): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true })
    const json = JSON.stringify(values)

    if (!this.available()) {
      throw new Error(
        'この環境では OS の暗号化が使えないため、シークレットを保存できません。' +
          '{{env.KEY}} で環境変数を参照してください。'
      )
    }

    await writeFile(this.file, safeStorage.encryptString(json))
    this.cache = values
  }

  async set(key: string, value: string): Promise<void> {
    const values = await this.load()
    await this.persist({ ...values, [key]: value })
  }

  async has(key: string): Promise<boolean> {
    const values = await this.load()
    return key in values
  }

  async delete(key: string): Promise<void> {
    const values = { ...(await this.load()) }
    delete values[key]
    await this.persist(values)
  }

  /** 鍵の一覧。値は返さない。 */
  async keys(): Promise<string[]> {
    return Object.keys(await this.load())
  }

  /** テンプレート展開に渡すための復号済みマップ。main プロセス内でだけ使う。 */
  async all(): Promise<Record<string, string>> {
    return { ...(await this.load()) }
  }

  isEncryptionAvailable(): boolean {
    return this.available()
  }
}
