import { generateKeyPairSync } from 'crypto';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync('key.pem', privateKey.export({ type: 'pkcs1', format: 'pem' }));
execSync('openssl req -x509 -new -nodes -key key.pem -sha256 -days 365 -out cert.pem -subj "/CN=192.168.0.16"', { stdio: 'pipe' });
console.log('Done: key.pem + cert.pem created');
