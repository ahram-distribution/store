const selfsigned = require('selfsigned');
const { writeFileSync } = require('fs');

async function main() {
  const attrs = [{ name: 'commonName', value: '192.168.0.16' }];
  const extensions = [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [
      { type: 7, ip: '192.168.0.16' },
      { type: 2, value: 'localhost' },
    ]},
  ];

  const pems = await selfsigned.generate(attrs, { extensions, days: 365 });
  writeFileSync('cert.pem', pems.cert);
  writeFileSync('key.pem', pems.private);
  console.log('Done: cert.pem + key.pem');
}
main();
