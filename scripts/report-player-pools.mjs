import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatReport } from './lib/player-pipeline.mjs'

const report = JSON.parse(readFileSync(join(process.cwd(), 'data-import/validation-report.json'), 'utf8'))
console.log(formatReport(report))
