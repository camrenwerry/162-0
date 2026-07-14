import { validateGeneratedData } from './lib/lahman-pipeline.mjs'

const report = validateGeneratedData(process.cwd())
if (report.errors.length) {
  console.error(report.errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Validated ${report.cards.toLocaleString()} generated cards across ${report.combinations} playable pools.`)
}
