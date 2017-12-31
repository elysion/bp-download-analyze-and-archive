const BPromise = require('bluebird')
const execAsync = BPromise.promisify(require('child_process').exec)
const recursiveAsync = BPromise.promisify(require("recursive-readdir"))
const fs = require('fs')
const R = require('ramda')
const downloadFromBeatport = require('bp-downloader')
const statAsync = BPromise.promisify(fs.stat)

const args = require('optimist')
  .usage('Download, analyze and archive tracks from Beatport.\n\nUsage: $0')
  .demand(['c', 'd', 'i', 'a'])
  .alias('d', 'downloads-dir')
  .describe('d', 'Target directory where the script will download the tracks to')
  .alias('c', 'credentials-file')
  .describe('c', `JSON file containing credentials used to log into Beatport \
(format: {"username": "YOUR_BEATPORT_USERNAME", "password": "YOUR_BEATPORT_PASSWORD"})`)
  .alias('i', 'ignore-file')
  .describe('i', `File to log downloaded track ids into. \
This also works as an input to prevent downloading already downloaded tracks`)
  .alias('a', 'archive-dir')
  .describe('a', 'Directory to archive tracks into after analyzing')
  .argv

const downloadsDir = args['downloads-dir'];
const credentials = require(args['credentials-file']);
const ignoreFile = args['ignore-file']
const archiveDir = args['archive-dir']

if (!fs.existsSync(downloadsDir)) {
  console.log('Downloads directory does not exist. Creating.')
  fs.mkdirSync(downloadsDir)
}

if (!fs.existsSync(archiveDir)) {
  console.log('Archive directory does not exist. Creating.')
  fs.mkdirSync(archiveDir)
}

const getDownloadedFilesAndMtimes = () => recursiveAsync(downloadsDir, ['!*.mp3'])
  .mapSeries(file => BPromise.all([file, statAsync(file).then(R.prop('mtime'))]))

const waitUntilFilesHaveChangedOrMoved = resolve => initialFilesAndMtimes => {
  console.log('Checking if files have been analyzed by MixedInKey...')

  return getDownloadedFilesAndMtimes()
    .then(updatedFilesAndMtimes => {
      const filesNotUpdated = initialFilesAndMtimes
        .filter(fileAndMtime => R.contains(fileAndMtime, updatedFilesAndMtimes))

      if (filesNotUpdated.length === 0) {
        resolve()
        return BPromise.resolve()
      } else {
        console.log(`${filesNotUpdated.length} files not analyzed yet, waiting...`)
        return BPromise.delay(10 * 1000)
          .then(() => waitUntilFilesHaveChangedOrMoved(resolve)(initialFilesAndMtimes))
      }
    }
  )
}

downloadFromBeatport(downloadsDir, credentials, ignoreFile)
  .then(() => new BPromise((resolve, reject) =>
    getDownloadedFilesAndMtimes()
      .tap(() => console.log('Adding tracks in download directory to MixedInKey'))
     .tap(() => execAsync(`osascript mik.scpt "${downloadsDir}"`))
      .then(waitUntilFilesHaveChangedOrMoved(resolve))
  ).timeout(60 * 10 * 1000))
  .tap(() => console.log(`Moving analyzed files to ${archiveDir}`))
  .tap(() => execAsync(`mv ${downloadsDir}/* ${archiveDir}/`))
  .tap(() => console.log('Done'))
  .catch(err => console.log(JSON.stringify(err, null, 2)))
