import fs from 'node:fs';
import webpush from 'web-push';
import { config } from './config.js';
import { deletePushSubscriptionByEndpoint, pushSubscriptionsForUser } from './db.js';

export type PushPayload = {
  title: string;
  body: string;
  conversationId: number;
  messageId: number;
  senderId: number;
};

type StoredVapid = { publicKey:string; privateKey:string; createdAt:string };

function loadOrCreateVapid(): StoredVapid {
  fs.mkdirSync(config.pushDir,{recursive:true});
  if(fs.existsSync(config.vapidFile)){
    const parsed=JSON.parse(fs.readFileSync(config.vapidFile,'utf8')) as StoredVapid;
    if(!parsed.publicKey || !parsed.privateKey) throw new Error('invalid_vapid_file');
    return parsed;
  }
  const keys=webpush.generateVAPIDKeys();
  const value:StoredVapid={publicKey:keys.publicKey,privateKey:keys.privateKey,createdAt:new Date().toISOString()};
  const tmp=`${config.vapidFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});
  fs.renameSync(tmp,config.vapidFile);
  try{fs.chmodSync(config.vapidFile,0o600);}catch{}
  return value;
}

const vapid=loadOrCreateVapid();
webpush.setVapidDetails(config.vapidSubject,vapid.publicKey,vapid.privateKey);

export function vapidPublicKey(): string { return vapid.publicKey; }

export async function sendPushToUser(userId:number,payload:PushPayload,activeDeviceIds:Set<string>=new Set()):Promise<void>{
  const subscriptions=pushSubscriptionsForUser(userId).filter(s=>!activeDeviceIds.has(s.deviceId));
  if(!subscriptions.length)return;
  const body=JSON.stringify(payload);
  await Promise.allSettled(subscriptions.map(async sub=>{
    try{
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},body,{TTL:60*60,urgency:'high'});
    }catch(error:any){
      const status=Number(error?.statusCode??0);
      if(status===404 || status===410){
        deletePushSubscriptionByEndpoint(sub.endpoint);
        return;
      }
      console.warn(`HomeChat push delivery failed for user ${userId}:`,error?.message??error);
    }
  }));
}
