
const fs = require('fs');
const path = require('path');

function generateLargeHar(outputPath, numEntries = 10000) {
  console.log(`Generating a dummy HAR file of ${numEntries} entries...`);
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  

  stream.write('{\n  "log": {\n    "version": "1.2",\n    "creator": { "name": "DummyGen", "version": "1.0" },\n    "pages": [],\n    "entries": [\n');
  

  const baseText = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPayload = '';
  for (let i = 0; i < 30000; i++) {
    randomPayload += baseText[Math.floor(Math.random() * baseText.length)];
  }
  
  for (let i = 0; i < numEntries; i++) {
    const entry = {
      startedDateTime: new Date(Date.now() - (numEntries - i) * 1000).toISOString(),
      time: Math.floor(Math.random() * 500) + 10,
      request: {
        method: i % 3 === 0 ? 'POST' : 'GET',
        url: `https://example.com/api/v1/resource/${i}?param=value&name=test_${i}`,
        httpVersion: 'HTTP/1.1',
        headers: [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: i % 3 === 0 ? 1024 : 0
      },
      response: {
        status: i % 10 === 0 ? 404 : (i % 7 === 0 ? 302 : 200),
        statusText: i % 10 === 0 ? 'Not Found' : (i % 7 === 0 ? 'Found' : 'OK'),
        httpVersion: 'HTTP/1.1',
        headers: [],
        cookies: [],
        content: {
          size: randomPayload.length,
          mimeType: i % 3 === 0 ? 'application/json' : 'text/html',
          text: randomPayload 
        },
        redirectURL: i % 7 === 0 ? 'https://example.com/login' : '',
        headersSize: -1,
        bodySize: randomPayload.length
      },
      cache: {},
      timings: { send: 1, wait: 2, receive: 3 },
      serverIPAddress: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
      connection: '80'
    };
    

    let entryStr = JSON.stringify(entry, null, 2);
    

    if (i < numEntries - 1) {
      entryStr += ',\n';
    } else {
      entryStr += '\n';
    }
    

    const indentedEntryStr = entryStr.split('\n').map(line => '      ' + line).join('\n');
    
    stream.write(indentedEntryStr);
    
    if (i > 0 && i % 1000 === 0) {
      console.log(`Generated ${i}/${numEntries} entries...`);
    }
  }
  

  stream.write('    ]\n  }\n}\n');
  stream.end();
  
  stream.on('finish', () => {
    const stats = fs.statSync(outputPath);
    console.log(`\nSuccessfully created dummy HAR file at: ${outputPath}`);
    console.log(`File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  });
}

const outputPath = path.resolve(__dirname, 'dummy_large.har');
generateLargeHar(outputPath, 10000);
