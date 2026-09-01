import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'

export interface TestServer {
  origin: string
  /** 受け取った計測リクエストのパス一覧 */
  hits: string[]
  close(): Promise<void>
}

const FIXTURES = join(__dirname, '..', 'fixtures')

/**
 * fixtures を配信する簡易サーバ。
 *
 * 計測タグの検証は、実在ドメインへ出ていかないよう
 * `/<パターン>` をそのままパスに持つローカルURLで代用する。
 * TrackingMonitor は URL 断片で判定するので、これで発火検出を通せる。
 */
export async function startServer(): Promise<TestServer> {
  const hits: string[] = []

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    if (path.includes('google-analytics.com') || path.includes('facebook.com/tr')) {
      hits.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'image/gif' })
      res.end()
      return
    }

    // POST は確認画面 / 完了画面へ進む
    if (req.method === 'POST') {
      // ボディを読み捨てる（読まないと接続が残る）
      await new Promise<void>((resolve) => {
        req.on('data', () => {})
        req.on('end', () => resolve())
      })
      const target = path === '/confirm' ? 'confirm.html' : 'thanks.html'
      const body = await readFile(join(FIXTURES, target), 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
      return
    }

    const file = path === '/' ? 'contact.html' : path.slice(1)
    try {
      const body = await readFile(join(FIXTURES, file), 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}
