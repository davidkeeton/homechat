import path from 'node:path';

export const APP_VERSION = '0.11.5';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './data/uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  tlsCertFile: process.env.TLS_CERT_FILE ? path.resolve(process.env.TLS_CERT_FILE) : null,
  tlsKeyFile: process.env.TLS_KEY_FILE ? path.resolve(process.env.TLS_KEY_FILE) : null,
  caCertFile: path.resolve(process.env.CA_CERT_FILE ?? path.join(process.env.DATA_DIR ?? './data','tls','homechat-root-ca.crt')),
};
