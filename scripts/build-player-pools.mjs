import { buildPools, formatReport, readInputs, validateBuiltData, writeBuiltData } from './lib/player-pipeline.mjs'

const root = process.cwd()
const inputs = readInputs(root)
const built = buildPools(inputs)
const report = validateBuiltData(built, inputs.config)
writeBuiltData(root, built, report)
console.log(formatReport(report))
if (report.errors.length) process.exit(1)
