const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { StringDecoder } = require('string_decoder');

// CSV headers to be written as the first line of the output CSV
const CSV_HEADERS = [
  'index',
  'startedDateTime',
  'method',
  'url',
  'status',
  'statusText',
  'mimeType',
  'time_ms',
  'requestBodySize',
  'responseBodySize',
  'serverIPAddress'
];


function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

class HarToCsvConverter {
  constructor(inputPath, outputPath) {
    this.inputPath = inputPath;
    this.outputPath = outputPath;
    this.totalBytes = fs.statSync(inputPath).size;
    this.bytesRead = 0;

    // State machine variables
    // States: 'FIND_ENTRIES_KEY' -> 'FIND_ARRAY_START' -> 'PARSE_ENTRIES' -> 'FINISHED'
    this.state = 'FIND_ENTRIES_KEY';
    this.carryOver = '';
    this.nestingLevel = 0;
    this.inString = false;
    this.escapeNext = false;
    this.currentEntry = '';
    this.entriesCount = 0;

    this.outStream = null;
    this.inStream = null;
    this.decoder = new StringDecoder('utf8');
  }

  convert() {
    return new Promise((resolve, reject) => {
      console.log(`Starting conversion of: ${this.inputPath}`);
      console.log(`Output path set to:      ${this.outputPath}`);
      console.log(`File size:               ${(this.totalBytes / (1024 * 1024)).toFixed(2)} MB\n`);


      try {
        this.outStream = fs.createWriteStream(this.outputPath, { encoding: 'utf8' });
        this.outStream.write(CSV_HEADERS.join(',') + '\n');
      } catch (err) {
        return reject(new Error(`Failed to create output file: ${err.message}`));
      }

      this.inStream = fs.createReadStream(this.inputPath, { highWaterMark: 64 * 1024 });

      this.inStream.on('data', (chunk) => {
        this.bytesRead += chunk.length;
        const textChunk = this.decoder.write(chunk);

        this.processChunk(textChunk);
        this.updateProgressBar();
      });

      this.inStream.on('end', () => {
        const remainingText = this.decoder.end();
        if (remainingText) {
          this.processChunk(remainingText);
        }

        this.closeStreams();
        console.log('\n\nConversion completed successfully.');
        console.log(`Total entries processed: ${this.entriesCount}`);
        resolve();
      });

      this.inStream.on('error', (err) => {
        this.closeStreams();
        reject(new Error(`Read stream error: ${err.message}`));
      });

      this.outStream.on('error', (err) => {
        this.closeStreams();
        reject(new Error(`Write stream error: ${err.message}`));
      });
    });
  }

  processChunk(chunkText) {
    let i = 0;
    const len = chunkText.length;

    while (i < len) {
      if (this.state === 'FIND_ENTRIES_KEY') {
        const searchStr = this.carryOver + chunkText.substring(i);
        const index = searchStr.indexOf('"entries"');

        if (index !== -1) {
          const matchIndexInChunk = i + index - this.carryOver.length;
          this.state = 'FIND_ARRAY_START';
          this.carryOver = '';
          i = matchIndexInChunk + 9;
        } else {
          this.carryOver = searchStr.slice(-15);
          break;
        }
      }
      else if (this.state === 'FIND_ARRAY_START') {
        const char = chunkText[i];
        if (char === '[') {
          this.state = 'PARSE_ENTRIES';
        }
        i++;
      }
      else if (this.state === 'PARSE_ENTRIES') {
        const char = chunkText[i];

        if (this.nestingLevel === 0) {
          if (char === '{') {
            this.nestingLevel = 1;
            this.inString = false;
            this.escapeNext = false;
            this.currentEntry = '{';
          } else if (char === ']') {
            this.state = 'FINISHED';
            break;
          }
        } else {
          this.currentEntry += char;
          if (this.escapeNext) {
            this.escapeNext = false;
          } else if (char === '\\') {
            this.escapeNext = true;
          } else if (char === '"') {
            this.inString = !this.inString;
          } else if (!this.inString) {
            if (char === '{') {
              this.nestingLevel++;
            } else if (char === '}') {
              this.nestingLevel--;
              if (this.nestingLevel === 0) {
                this.handleEntryParsed(this.currentEntry);
                this.currentEntry = '';
              }
            }
          }
        }
        i++;
      }
      else if (this.state === 'FINISHED') {
        break;
      }
    }
  }

  handleEntryParsed(entryJson) {
    try {
      const entry = JSON.parse(entryJson);
      this.entriesCount++;

      const req = entry.request || {};
      const res = entry.response || {};
      const content = res.content || {};

      const row = [
        this.entriesCount,
        entry.startedDateTime || '',
        req.method || '',
        req.url || '',
        res.status !== undefined ? res.status : '',
        res.statusText || '',
        content.mimeType || '',
        entry.time !== undefined ? entry.time : '',
        req.bodySize !== undefined ? req.bodySize : '',
        res.bodySize !== undefined ? res.bodySize : '',
        entry.serverIPAddress || ''
      ];

      const csvLine = row.map(escapeCsvCell).join(',') + '\n';
      this.outStream.write(csvLine);
    } catch (err) {
      process.stderr.write(`\nWarning: Skip malformed entry #${this.entriesCount + 1}: ${err.message}\n`);
    }
  }

  updateProgressBar() {
    const percent = this.totalBytes > 0 ? (this.bytesRead / this.totalBytes) * 100 : 0;
    const barLength = 30;
    const filledLength = Math.round((percent / 100) * barLength);
    const bar = '='.repeat(filledLength) + '>'.padEnd(barLength - filledLength, ' ');

    const mbRead = (this.bytesRead / (1024 * 1024)).toFixed(1);
    const mbTotal = (this.totalBytes / (1024 * 1024)).toFixed(1);

    readline.clearLine(process.stderr, 0);
    readline.cursorTo(process.stderr, 0);
    process.stderr.write(`Progress: [${bar}] ${percent.toFixed(1)}% (${mbRead}/${mbTotal} MB) | Entries: ${this.entriesCount}`);
  }

  closeStreams() {
    if (this.inStream) {
      this.inStream.destroy();
    }
    if (this.outStream) {
      this.outStream.end();
    }
  }
}


function showHelp() {
  console.log(`
HAR to CSV Converter - Clean & Efficient

Convert large HTTP Archive (HAR) files into CSV format streamingly.
Supports files larger than 300MB+ with minimal memory footprint.

Usage:
  node har_to_csv.js <input-file.har> [output-file.csv]

Arguments:
  <input-file.har>   Path to the HAR file to convert (required)
  [output-file.csv]  Path for the output CSV file (optional, defaults to same name/path with .csv)
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const inputPath = path.resolve(args[0]);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file does not exist: ${inputPath}`);
    process.exit(1);
  }

  let outputPath;
  if (args[1]) {
    outputPath = path.resolve(args[1]);
  } else {
    const parsed = path.parse(inputPath);
    outputPath = path.join(parsed.dir, parsed.name + '.csv');
  }

  const converter = new HarToCsvConverter(inputPath, outputPath);
  converter.convert()
    .catch((err) => {
      console.error(`\nConversion failed: ${err.message}`);
      process.exit(1);
    });
}

main();
