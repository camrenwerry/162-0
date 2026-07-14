import { buildPools, formatReport, readInputs, validateBuiltData, writeBuiltData, writeValidationReport } from './lib/player-pipeline.mjs'

const root = process.cwd()
const inputs = readInputs(root)
const built = buildPools(inputs)
const report = validateBuiltData(built, inputs.config)
writeValidationReport(root, report)
if (!report.errors.length) writeBuiltData(root, built)
console.log(formatReport(report))
if (report.errors.length) process.exit(1)
