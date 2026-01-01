import * as admin from 'firebase-admin';

const serviceAccount = require('../../firebase-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('[INFO] Successfully connected to Firestore.');

export { db };