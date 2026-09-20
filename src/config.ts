import path from 'node:path';

export const APP_VERSION = '0.11.6';

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  httpPort: Number(process.env.HTTP_PORT ?? 3000),
  httpsPort: Number(process.env.HTTPS_PORT ?? 3001),
  publicHttpsPort: Number(process.env.PUBLIC_HTTPS_PORT ?? 8093),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './data/uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  tlsCertFile: path.resolve(process.env.TLS_CERT_FILE ?? path.join(process.env.DATA_DIR ?? './data','tls','homechat.crt')),
  tlsKeyFile: path.resolve(process.env.TLS_KEY_FILE ?? path.join(process.env.DATA_DIR ?? './data','tls','homechat.key')),
  caCertFile: path.resolve(process.env.CA_CERT_FILE ?? path.join(process.env.DATA_DIR ?? './data','tls','homechat-root-ca.crt')),
};
