import path from 'node:path';

export const APP_VERSION = '0.12.0';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const tlsDir = path.resolve(process.env.TLS_DIR ?? path.join(dataDir,'tls'));

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  publicHost: String(process.env.HOMECHAT_HOST ?? 'localhost').trim() || 'localhost',
  httpPort: Number(process.env.HTTP_PORT ?? 3000),
  httpsPort: Number(process.env.HTTPS_PORT ?? 3001),
  publicHttpsPort: Number(process.env.PUBLIC_HTTPS_PORT ?? 8093),
  dataDir,
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? path.join(dataDir,'uploads')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  autoTls: !['0','false','no'].includes(String(process.env.HOMECHAT_AUTO_TLS ?? 'true').toLowerCase()),
  tlsDir,
  tlsCertFile: path.resolve(process.env.TLS_CERT_FILE ?? path.join(tlsDir,'homechat.crt')),
  tlsKeyFile: path.resolve(process.env.TLS_KEY_FILE ?? path.join(tlsDir,'homechat.key')),
  caCertFile: path.resolve(process.env.CA_CERT_FILE ?? path.join(tlsDir,'homechat-root-ca.crt')),
  caKeyFile: path.resolve(process.env.CA_KEY_FILE ?? path.join(tlsDir,'homechat-root-ca.key')),
};
