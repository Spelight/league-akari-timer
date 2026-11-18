const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const config = yaml.load(fs.readFileSync(path.join(__dirname, 'electron-builder.yml'), 'utf8'))
config.directories.output = path.join(__dirname, 'dist/timer')
config.files.push('!work{,/**}', '!electron-builder.timer.cjs')
config.win.requestedExecutionLevel = 'requireAdministrator'
config.extraMetadata = { version: '1.5.2-beta.timer.20261118.3' }
module.exports = config
