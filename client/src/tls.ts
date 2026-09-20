import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { config } from './config.js';

function runOpenSsl(args: string[]): void {
  const result = spawnSync('openssl', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`openssl_failed: ${args[0]}`);
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function subjectAltNames(host: string): string {
  const sans: string[] = [];
  if (net.isIP(host)) sans.push(`IP:${host}`);
  else sans.push(`DNS:${host}`);
  sans.push('DNS:localhost','IP:127.0.0.1');
  return unique(sans).join(',');
}

export function ensureTlsMaterial(): boolean {
  if (fs.existsSync(config.tlsCertFile) && fs.existsSync(config.tlsKeyFile) && fs.existsSync(config.caCertFile)) return true;
  if (!config.autoTls) return false;

  fs.mkdirSync(config.tlsDir, { recursive: true });

  const caReady = fs.existsSync(config.caCertFile) && fs.existsSync(config.caKeyFile);
  if (!caReady) {
    console.log(`HomeChat: generating local root CA in ${config.tlsDir}`);
    runOpenSsl(['genrsa','-out',config.caKeyFile,'3072']);
    runOpenSsl(['req','-x509','-new','-nodes','-key',config.caKeyFile,'-sha256','-days','3650','-subj','/CN=HomeChat Local Root CA','-out',config.caCertFile]);
    fs.chmodSync(config.caKeyFile, 0o600);
    fs.chmodSync(config.caCertFile, 0o644);
  }

  if (!fs.existsSync(config.tlsCertFile) || !fs.existsSync(config.tlsKeyFile)) {
    console.log(`HomeChat: generating HTTPS certificate for ${config.publicHost}`);
    const csr = path.join(config.tlsDir,'homechat.csr');
    const ext = path.join(config.tlsDir,'homechat.ext');
    const serial = path.join(config.tlsDir,'homechat-root-ca.srl');
    const san = subjectAltNames(config.publicHost);

    runOpenSsl(['genrsa','-out',config.tlsKeyFile,'2048']);
    runOpenSsl(['req','-new','-key',config.tlsKeyFile,'-subj',`/CN=${config.publicHost}`,'-out',csr]);
    fs.writeFileSync(ext, `subjectAltName = ${san}
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
`, 'utf8');
    runOpenSsl(['x509','-req','-in',csr,'-CA',config.caCertFile,'-CAkey',config.caKeyFile,'-CAcreateserial','-out',config.tlsCertFile,'-days','825','-sha256','-extfile',ext]);

    for (const file of [csr, ext, serial]) {
      try { fs.rmSync(file); } catch {}
    }
    fs.chmodSync(config.tlsKeyFile, 0o600);
    fs.chmodSync(config.tlsCertFile, 0o644);
  }

  return fs.existsSync(config.tlsCertFile) && fs.existsSync(config.tlsKeyFile) && fs.existsSync(config.caCertFile);
}
