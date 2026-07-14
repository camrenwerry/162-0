import { buildLahmanData, writeGeneratedData } from './lib/lahman-pipeline.mjs'

const root = process.cwd()
const built = buildLahmanData(root)
writeGeneratedData(root, built)
console.log(`Generated ${built.report.summary.cards.toLocaleString()} cards across ${built.report.summary.validPools} validated pools (${built.report.summary.excludedPools} excluded).`)
