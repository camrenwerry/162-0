import { formatReport, readBuiltData, readInputs, validateBuiltData } from './lib/player-pipeline.mjs'

const root = process.cwd()
const { config } = readInputs(root)
const report = validateBuiltData(readBuiltData(root), config)
console.log(formatReport(report))
if (report.errors.length) process.exit(1)
