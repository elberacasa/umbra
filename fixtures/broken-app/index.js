const http = require('http');

// Deliberate syntax error: unterminated function body / missing closing brace.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('never reached'

server.listen(3000, () => {
  console.log('broken-app listening on port 3000');
});
