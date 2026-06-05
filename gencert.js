const { writeFileSync } = require('fs');
const { execSync } = require('child_process');

// Try with openssl first
try {
  execSync('openssl version', { stdio: 'pipe' });
  execSync('openssl req -x509 -new -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=192.168.0.16"', { stdio: 'pipe' });
  console.log('Cert generated with openssl');
} catch {
  // Fallback: generate a self-signed cert using Node.js crypto
  // We'll create minimal PEM files manually
  const crypto = require('crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  
  writeFileSync('key.pem', privPem);
  
  // Create a minimal self-signed X509 cert
  // Note: Node.js 15+ has X509Certificate but not for creating
  // For simplicity, we'll just use the key and tell Vite to use it
  // Vite's https: true will auto-generate if no key/cert provided
  console.log('Key generated. Vite can auto-generate cert with https: true');
}
