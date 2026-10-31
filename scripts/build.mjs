import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const files = await Promise.all(['host.js', 'interval.js'].map(async name => [name, await readFile(new URL(`lib/${name}`, root), 'utf8')]))
const revision = createHash('sha256').update(files.map(([name, text]) => `${name}\0${text}`).join('\0')).digest('hex').slice(0, 12)
const directory = new URL(`dist/host/${revision}/`, root)
await mkdir(directory, { recursive: true })
for (const [name, content] of files) {
  const target = new URL(name, directory)
  let previous
  try { previous = await readFile(target, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous !== undefined && previous !== content) throw new Error(`Immutable release collision for ${revision}/${name}`)
  if (previous === undefined) await writeFile(target, content, { flag: 'wx' })
}
const clientPath = new URL('lib/client.js', root)
const client = await readFile(clientPath, 'utf8')
const parser = files.find(([name]) => name === 'interval.js')[1].replace(/^export /gm, '').trimEnd()
const updated = client.replace(/    \/\/ BEGIN SHARED INTERVAL[\s\S]*?    \/\/ END SHARED INTERVAL/, `    // BEGIN SHARED INTERVAL\n${parser.split('\n').map(line => `    ${line}`).join('\n')}\n    // END SHARED INTERVAL`)
if (updated !== client) await writeFile(clientPath, updated)
const manifest = JSON.stringify({ revision, entry: `./dist/host/${revision}/host.js` }, null, 2) + '\n'
const target = new URL('release.json', root)
let previous
try { previous = await readFile(target, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
if (previous !== manifest) await writeFile(target, manifest)
console.log(`Goal Mode host ${revision}`)
